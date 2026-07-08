"""
AI Character Library Models – 全局只读 AI 角色资源库（AI角色）。

区别于 `Character`（用户私有、可删改）与 `ProjectAsset`（项目内可编辑要素）：
本库是系统级、管理员导入、普通用户**不可增删改**的角色目录，按多级
分类树组织。用户在项目「要素配置·角色」中浏览选择后，会被**实例化**
（复制图片 + 属性）为一个独立可编辑的 `ProjectAsset`。

资源来源：AI_role_stock 目录树，逐级目录 = 一级分类，叶子文件夹 = 一个角色
（含 1-4.png 与 角色属性.txt）。

MinIO 布局：
  public/ai_characters/{category_path}/{character_key}/{slot}.png
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class AICharacterCategory(Base):
    """多级分类树节点（自引用）。path 为物化路径，便于按前缀查询子树。"""
    __tablename__ = "ai_character_categories"

    parent_id  = Column(Integer, ForeignKey("ai_character_categories.id", ondelete="CASCADE"),
                        nullable=True, index=True)
    name       = Column(String(200), nullable=False)          # 该级目录名，如 "中国-先秦"
    path       = Column(String(500), unique=True, index=True, nullable=False)  # "古代历史/中国-先秦"
    level      = Column(Integer, default=1, nullable=False)    # 从 1 开始
    sort_order = Column(Integer, default=0)
    # 树结构通过 parent_id + 物化 path 表达；不建立 ORM self-relationship，按 path 查询子树。


class AICharacter(Base):
    """AI 角色定义（全局，无 user_id / tenant_id —— 面向所有租户只读共享）。"""
    __tablename__ = "ai_characters"

    character_key = Column(String(36), unique=True, index=True, nullable=False)  # UUID
    category_id   = Column(Integer, ForeignKey("ai_character_categories.id"),
                          nullable=False, index=True)
    path          = Column(String(500), index=True, nullable=False)  # 所属分类物化路径

    name          = Column(String(200), nullable=False)   # = 角色文件夹名

    # 结构化属性（来自 角色属性.txt 的固定 13 维），JSON 字符串：
    #   {"大类":"古代","文化区域":"东亚",...,"气质":"癫狂","场景":"..."}
    attributes_json = Column(Text, nullable=True)
    attributes_raw  = Column(Text, nullable=True)          # 原始 txt 全文（存档/追溯）

    feature_desc  = Column(Text, nullable=True)            # 辨识特征
    costume_desc  = Column(Text, nullable=True)            # 着装描述

    cover_path    = Column(String(500), nullable=True)     # 主图（1.png）MinIO key
    sort_order    = Column(Integer, default=0)

    images = relationship(
        "AICharacterImage",
        back_populates="character",
        lazy="selectin",
        order_by="AICharacterImage.slot",
        cascade="all, delete-orphan",
    )


class AICharacterImage(Base):
    __tablename__ = "ai_character_images"

    ai_character_id = Column(Integer, ForeignKey("ai_characters.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    image_path = Column(String(500), nullable=False)   # MinIO object key
    slot       = Column(Integer, default=1)            # 1-4：左上顺时针 立绘/肖像/表情九宫格/三视图
    sort_order = Column(Integer, default=0)

    character = relationship("AICharacter", back_populates="images")
