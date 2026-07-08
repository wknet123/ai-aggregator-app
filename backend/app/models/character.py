"""
Character Identity Model – persists character assets with feature fingerprints.

MinIO layout: users/{uid}/characters/{character_id}/ref_{n}.png
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class Character(Base):
    __tablename__ = "characters"

    character_id = Column(String(36), unique=True, index=True, nullable=False)
    user_id      = Column(Integer, nullable=False, index=True)
    tenant_id    = Column(Integer, nullable=False, index=True)

    name         = Column(String(200), nullable=False)
    prompt_description = Column(Text, nullable=True)   # e.g. "红色夹克、银发"
    profile_json = Column(Text, nullable=True)         # Structured CharacterProfile JSON

    # Simulated IP-Adapter feature vector (JSON array of floats)
    feature_vector  = Column(Text, nullable=True)
    # A short hex-like fingerprint derived from the vector for display
    fingerprint     = Column(String(32), nullable=True)

    # draft → processing → active
    status       = Column(String(20), default="draft", index=True)

    # Avatar / thumbnail (first uploaded image, MinIO key)
    avatar_path  = Column(String(500), nullable=True)

    deleted_at   = Column(DateTime, nullable=True)

    images = relationship("CharacterImage", back_populates="character", lazy="selectin")


class CharacterImage(Base):
    __tablename__ = "character_images"

    character_id = Column(Integer, ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)
    image_path   = Column(String(500), nullable=False)   # MinIO object key
    sort_order   = Column(Integer, default=0)

    character = relationship("Character", back_populates="images")
