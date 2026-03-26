"""
Centralized logging configuration for AI Ticket Routing System
"""

import logging
import sys
from pathlib import Path
from datetime import datetime

def setup_logger(name: str, level: int = logging.INFO) -> logging.Logger:
    """
    Set up a logger with consistent formatting
    
    Args:
        name: Logger name (typically __name__ from calling module)
        level: Logging level (default: INFO)
        
    Returns:
        logging.Logger: Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Only configure if not already configured
    if not logger.handlers:
        logger.setLevel(level)
        
        # Create console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        
        # Create formatter
        formatter = logging.Formatter(
            fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        console_handler.setFormatter(formatter)
        
        # Add handler to logger
        logger.addHandler(console_handler)
        
        # Prevent propagation to root logger
        logger.propagate = False
    
    return logger


def setup_file_logger(name: str, log_dir: str = 'logs', level: int = logging.INFO) -> logging.Logger:
    """
    Set up a logger that writes to both console and file
    Log filename format: ai_ticket_routing_YYYY-MM-DD.log
    
    Args:
        name: Logger name
        log_dir: Directory for log files (default: 'logs')
        level: Logging level
        
    Returns:
        logging.Logger: Configured logger instance
    """
    logger = setup_logger(name, level)
    
    # Add file handler if not already present
    if not any(isinstance(h, logging.FileHandler) for h in logger.handlers):
        # Create logs directory if it doesn't exist
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        
        # Generate log filename with date: ai_ticket_routing_2026-03-23.log
        today = datetime.now().strftime('%Y-%m-%d')
        log_file = log_path / f'ai_ticket_routing_{today}.log'
        
        # Create file handler
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(level)
        
        # Use same formatter
        formatter = logging.Formatter(
            fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(formatter)
        
        logger.addHandler(file_handler)
    
    return logger