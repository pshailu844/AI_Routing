import os
import csv
import hashlib
import time
import jwt
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from service.logger import setup_file_logger

logger = setup_file_logger(__name__)

# Constants
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-key-for-ai-routing")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRATION_HOURS = 24
CSV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'users.csv')
SAVE_INTERVAL_SECONDS = 10

class AuthService:
    def __init__(self):
        self.users_cache: Dict[str, dict] = {}  # In-memory cache: username -> user_data
        self.is_dirty = False  # Track if cache needs saving to CSV
        self.lock = threading.Lock()  # Ensure thread safety for multi-user access
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
        
        # Initial load from CSV
        self._load_from_csv()
        
        # Start background saving thread
        self._start_periodic_save()
        
    def _load_from_csv(self):
        """Load users from CSV file into memory cache"""
        if not os.path.exists(CSV_PATH):
            logger.info("auth_service | _load_from_csv | CSV file not found, creating new one")
            self._save_to_csv()  # Create empty file with headers
            return
            
        try:
            with self.lock:
                with open(CSV_PATH, mode='r', newline='', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        # row = {'username', 'email', 'full_name', 'password_hash', 'created_at'}
                        self.users_cache[row['username']] = row
            logger.info(f"auth_service | _load_from_csv | Loaded {len(self.users_cache)} users")
        except Exception as e:
            logger.error(f"auth_service | _load_from_csv | Error loading CSV: {e}")

    def _save_to_csv(self):
        """Write current memory cache to CSV file"""
        try:
            with self.lock:
                with open(CSV_PATH, mode='w', newline='', encoding='utf-8') as f:
                    fieldnames = ['username', 'email', 'full_name', 'password_hash', 'created_at']
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    for user_data in self.users_cache.values():
                        writer.writerow(user_data)
            self.is_dirty = False
            logger.info("auth_service | _save_to_csv | Users data persisted to CSV")
        except Exception as e:
            logger.error(f"auth_service | _save_to_csv | Error saving to CSV: {e}")

    def _start_periodic_save(self):
        """Background thread to save data to CSV every N seconds if dirty"""
        def save_loop():
            while True:
                time.sleep(SAVE_INTERVAL_SECONDS)
                if self.is_dirty:
                    self._save_to_csv()
                    
        thread = threading.Thread(target=save_loop, daemon=True)
        thread.start()

    def _hash_password(self, password: str) -> str:
        """Simple SHA-256 password hashing for this template"""
        return hashlib.sha256(password.encode()).hexdigest()

    def register(self, username, email, full_name, password) -> dict:
        """Register a new user"""
        with self.lock:
            if username in self.users_cache:
                return {"status": "error", "message": "Username already exists"}
            
            user_data = {
                "username": username,
                "email": email,
                "full_name": full_name,
                "password_hash": self._hash_password(password),
                "created_at": datetime.now().isoformat()
            }
            
            self.users_cache[username] = user_data
            self.is_dirty = True
            
        logger.info(f"auth_service | register | User registered: {username}")
        return {"status": "success", "message": "User registered successfully"}

    def login(self, username, password) -> dict:
        """Authenticate user and return JWT token"""
        user = self.users_cache.get(username)
        if not user or user['password_hash'] != self._hash_password(password):
            return {"status": "error", "message": "Invalid username or password"}
            
        # Generate JWT Token
        payload = {
            "username": username,
            "email": user['email'],
            "full_name": user['full_name'],
            "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRATION_HOURS)
        }
        
        token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        
        logger.info(f"auth_service | login | User logged in: {username}")
        return {
            "status": "success", 
            "token": token, 
            "user": {
                "username": username,
                "email": user['email'],
                "full_name": user['full_name']
            }
        }

    def verify_token(self, token: str) -> Optional[dict]:
        """Verify JWT token and return payload"""
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            return payload
        except jwt.ExpiredSignatureError:
            logger.warning("auth_service | verify_token | Token expired")
            return None
        except jwt.InvalidTokenError:
            logger.warning("auth_service | verify_token | Invalid token")
            return None
        except Exception as e:
            logger.error(f"auth_service | verify_token | Error: {e}")
            return None
