"""
Transaction Model - Credit transaction history
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Enum
from sqlalchemy.orm import relationship
import enum
from app.db.base import Base


class TransactionType(str, enum.Enum):
    """Transaction type enumeration"""
    RECHARGE = "RECHARGE"
    CONSUMPTION = "CONSUMPTION"
    REFUND = "REFUND"
    ADJUSTMENT = "ADJUSTMENT"


class TransactionStatus(str, enum.Enum):
    """Transaction status enumeration"""
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Transaction(Base):
    """Transaction model for credit operations"""
    
    __tablename__ = "transactions"
    
    type = Column(Enum(TransactionType), nullable=False)
    amount = Column(Integer, nullable=False)
    status = Column(Enum(TransactionStatus), default=TransactionStatus.PENDING, nullable=False)
    description = Column(String(255))
    reference_id = Column(String(100))  # External payment reference
    
    # Foreign Keys
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    
    # Relationships
    tenant = relationship("Tenant", back_populates="transactions")
    
    def __repr__(self):
        return f"<Transaction {self.type} {self.amount} {self.status}>"
