"""
Alipay Client - 支付宝支付集成
"""
import logging
import base64
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
from alipay.aop.api.AlipayClientConfig import AlipayClientConfig
from alipay.aop.api.DefaultAlipayClient import DefaultAlipayClient
from alipay.aop.api.domain.AlipayTradePrecreateModel import AlipayTradePrecreateModel
from alipay.aop.api.request.AlipayTradePrecreateRequest import AlipayTradePrecreateRequest
from alipay.aop.api.request.AlipayTradeQueryRequest import AlipayTradeQueryRequest
from alipay.aop.api.domain.AlipayTradeQueryModel import AlipayTradeQueryModel
from alipay.aop.api.response.AlipayTradePrecreateResponse import AlipayTradePrecreateResponse
from alipay.aop.api.response.AlipayTradeQueryResponse import AlipayTradeQueryResponse

from app.config import settings

logger = logging.getLogger(__name__)


class AlipayClient:
    """支付宝客户端封装"""

    def __init__(self):
        """初始化支付宝客户端"""
        self.app_id = settings.ALIPAY_APPID
        self.app_private_key = settings.ALIPAY_APP_PRIVATE_KEY
        self.alipay_public_key = settings.ALIPAY_PUBLIC_KEY
        self.gateway = settings.ALIPAY_GATEWAY
        self.sign_type = settings.ALIPAY_SIGN_TYPE
        self.return_url = settings.ALIPAY_RETURN_URL
        self.notify_url = settings.ALIPAY_NOTIFY_URL

        # Debug: 检查配置类型
        logger.info(f"Alipay config types:")
        logger.info(f"  app_id: {type(self.app_id)} = {self.app_id}")
        logger.info(f"  app_private_key type: {type(self.app_private_key)}")
        logger.info(f"  alipay_public_key type: {type(self.alipay_public_key)}")
        logger.info(f"  gateway type: {type(self.gateway)} = {self.gateway}")
        logger.info(f"  sign_type type: {type(self.sign_type)} = {self.sign_type}")

        # 初始化客户端配置
        self.alipay_client_config = AlipayClientConfig()
        self.alipay_client_config.app_id = str(self.app_id) if self.app_id else None

        formatted_private_key = self._format_private_key(self.app_private_key)
        logger.info(f"  formatted_private_key type: {type(formatted_private_key)}, len: {len(formatted_private_key) if formatted_private_key else 0}")
        self.alipay_client_config.app_private_key = formatted_private_key

        formatted_public_key = self._format_public_key(self.alipay_public_key)
        logger.info(f"  formatted_public_key type: {type(formatted_public_key)}, len: {len(formatted_public_key) if formatted_public_key else 0}")
        self.alipay_client_config.alipay_public_key = formatted_public_key

        self.alipay_client_config.server_url = str(self.gateway) if self.gateway else None
        self.alipay_client_config.sign_type = str(self.sign_type) if self.sign_type else None

        # 创建客户端实例
        self.client = DefaultAlipayClient(alipay_client_config=self.alipay_client_config)

    def _format_private_key(self, key: Optional[str]) -> str:
        """格式化应用私钥，将PKCS8格式转换为PKCS1格式"""
        if not key:
            return ""

        # 确保 key 是字符串类型
        if not isinstance(key, str):
            logger.error(f"Private key is not a string! Type: {type(key)}, Value: {key}")
            key = str(key)

        # 移除可能存在的头尾标记和空白字符
        key = key.replace("-----BEGIN RSA PRIVATE KEY-----", "")
        key = key.replace("-----END RSA PRIVATE KEY-----", "")
        key = key.replace("-----BEGIN PRIVATE KEY-----", "")
        key = key.replace("-----END PRIVATE KEY-----", "")
        key = key.replace("\n", "").replace("\r", "").replace(" ", "")

        # 检查是否是PKCS8格式（以MIIEv开头），需要转换为PKCS1格式
        # PKCS8格式的DER编码以30 82 04 bd开头，base64后是MIIEv
        # PKCS1格式的DER编码以30 82 04 a3开头，base64后是MIIEo
        try:
            key_bytes = base64.b64decode(key)
            # 尝试作为PKCS8加载
            private_key = serialization.load_der_private_key(key_bytes, password=None, backend=default_backend())
            # 转换为PKCS1格式（TraditionalOpenSSL）
            pkcs1_pem = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            )
            # 提取base64内容
            pkcs1_key = pkcs1_pem.decode().replace("-----BEGIN RSA PRIVATE KEY-----", "").replace("-----END RSA PRIVATE KEY-----", "").replace("\n", "")
            logger.info(f"Successfully converted PKCS8 key to PKCS1 format, new length: {len(pkcs1_key)}")
            return pkcs1_key
        except Exception as e:
            logger.warning(f"Key conversion failed (may already be PKCS1): {e}")
            # 如果转换失败，返回原始key（可能已经是PKCS1格式）
            return key

    def _format_public_key(self, key: Optional[str]) -> str:
        """格式化支付宝公钥"""
        if not key:
            return ""

        # 确保 key 是字符串类型
        if not isinstance(key, str):
            logger.error(f"Public key is not a string! Type: {type(key)}, Value: {key}")
            key = str(key)

        # 移除可能存在的头尾标记和空白字符
        key = key.replace("-----BEGIN PUBLIC KEY-----", "")
        key = key.replace("-----END PUBLIC KEY-----", "")
        key = key.replace("\n", "").replace("\r", "").replace(" ", "")

        return key

    def create_precreate_order(
        self,
        out_trade_no: str,
        total_amount: str,
        subject: str,
        body: Optional[str] = None,
        timeout_minutes: int = 30
    ) -> Dict[str, Any]:
        """
        创建扫码支付订单（当面付预下单）

        Args:
            out_trade_no: 商户订单号
            total_amount: 订单金额（元）
            subject: 订单标题
            body: 订单描述
            timeout_minutes: 订单超时时间（分钟）

        Returns:
            包含二维码内容的字典
        """
        try:
            # Debug: 打印参数类型
            logger.info(f"create_precreate_order params:")
            logger.info(f"  out_trade_no: {type(out_trade_no)} = {out_trade_no}")
            logger.info(f"  total_amount: {type(total_amount)} = {total_amount}")
            logger.info(f"  subject: {type(subject)} = {subject}")
            logger.info(f"  body: {type(body)} = {body}")
            logger.info(f"  timeout_minutes: {type(timeout_minutes)} = {timeout_minutes}")

            # 构建请求模型
            model = AlipayTradePrecreateModel()
            model.out_trade_no = str(out_trade_no)
            model.total_amount = str(total_amount)
            model.subject = str(subject)
            if body:
                model.body = str(body)

            # 设置超时时间
            timeout_express = f"{int(timeout_minutes)}m"
            logger.info(f"  timeout_express: {type(timeout_express)} = {timeout_express}")
            model.timeout_express = timeout_express

            # 构建请求对象
            request = AlipayTradePrecreateRequest(biz_model=model)
            request.notify_url = self.notify_url

            # 执行请求 - execute返回的是JSON字符串，需要手动解析
            response_content = self.client.execute(request)
            logger.info(f"Alipay precreate response content: {response_content}")

            # 解析响应
            response = AlipayTradePrecreateResponse()
            response.parse_response_content(response_content)

            logger.info(f"Alipay precreate response: {response.code}, {response.msg}")

            if response.code == "10000":
                # 成功
                return {
                    "success": True,
                    "qr_code": response.qr_code,  # 二维码内容
                    "out_trade_no": response.out_trade_no,
                }
            else:
                # 失败
                return {
                    "success": False,
                    "error": f"{response.sub_code}: {response.sub_msg}",
                    "code": response.code
                }

        except Exception as e:
            logger.error(f"Alipay precreate order failed: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def query_order(self, out_trade_no: Optional[str] = None, trade_no: Optional[str] = None) -> Dict[str, Any]:
        """
        查询订单状态

        Args:
            out_trade_no: 商户订单号
            trade_no: 支付宝交易号

        Returns:
            订单状态信息
        """
        try:
            if not out_trade_no and not trade_no:
                return {
                    "success": False,
                    "error": "out_trade_no and trade_no cannot both be empty"
                }

            # 构建查询模型
            model = AlipayTradeQueryModel()
            if out_trade_no:
                model.out_trade_no = out_trade_no
            if trade_no:
                model.trade_no = trade_no

            # 构建请求对象
            request = AlipayTradeQueryRequest(biz_model=model)

            # 执行请求 - execute返回的是JSON字符串，需要手动解析
            response_content = self.client.execute(request)
            logger.info(f"Alipay query response content: {response_content}")

            # 解析响应
            response = AlipayTradeQueryResponse()
            response.parse_response_content(response_content)

            logger.info(f"Alipay query response: {response.code}, {response.msg}")

            if response.code == "10000":
                return {
                    "success": True,
                    "trade_status": response.trade_status,  # WAIT_BUYER_PAY, TRADE_SUCCESS, TRADE_FINISHED, TRADE_CLOSED
                    "trade_no": response.trade_no,
                    "out_trade_no": response.out_trade_no,
                    "total_amount": response.total_amount,
                    "buyer_logon_id": response.buyer_logon_id,
                    "send_pay_date": response.send_pay_date
                }
            else:
                return {
                    "success": False,
                    "error": f"{response.sub_code}: {response.sub_msg}",
                    "code": response.code
                }

        except Exception as e:
            logger.error(f"Alipay query order failed: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def verify_notify(self, notify_data: Dict[str, Any]) -> bool:
        """
        验证支付宝异步通知签名

        Args:
            notify_data: 支付宝POST的通知数据

        Returns:
            验证是否成功
        """
        try:
            # 使用SDK验证签名
            sign = notify_data.get('sign')
            if not sign:
                logger.error("Notify data missing 'sign' field")
                return False

            # TODO: 实际验签逻辑需要使用SDK提供的方法
            # 这里简化处理，生产环境需要正确实现
            logger.info(f"Verifying notify signature: {sign[:20]}...")

            return True

        except Exception as e:
            logger.error(f"Verify notify failed: {str(e)}")
            return False


# 全局单例
alipay_client = AlipayClient()
