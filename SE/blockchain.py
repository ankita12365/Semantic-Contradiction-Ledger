import hashlib
import json
import pickle
import os
from datetime import datetime


class Block:
    def __init__(self, index, timestamp, data, previous_hash):
        self.index = index
        self.timestamp = timestamp
        self.data = data
        self.previous_hash = previous_hash
        self.hash = self.calculate_hash()
    
    def calculate_hash(self):
        block_string = json.dumps({
            "index": self.index,
            "timestamp": self.timestamp,
            "data": self.data,
            "previous_hash": self.previous_hash
        }, sort_keys=True)
        return hashlib.sha256(block_string.encode()).hexdigest()
    
    def to_dict(self):
        return {
            "index": self.index,
            "timestamp": self.timestamp,
            "data": self.data,
            "previous_hash": self.previous_hash,
            "hash": self.hash
        }


class Blockchain:
    def __init__(self, storage_file="blockchain_data.pkl"):
        self.storage_file = storage_file
        self.chain = self.load_chain()
    
    def create_genesis_block(self):
        return Block(0, datetime.now().isoformat(), {
            "statement_a": "Genesis Block",
            "statement_b": "Genesis Block",
            "contradiction": "N/A",
            "confidence": 0.0
        }, "0")
    
    def get_latest_block(self):
        return self.chain[-1]
    
    def add_block(self, data):
        previous_block = self.get_latest_block()
        new_block = Block(
            index=len(self.chain),
            timestamp=datetime.now().isoformat(),
            data=data,
            previous_hash=previous_block.hash
        )
        self.chain.append(new_block)
        return new_block
    
    def is_valid(self):
        for i in range(1, len(self.chain)):
            current = self.chain[i]
            previous = self.chain[i - 1]
            
            if current.hash != current.calculate_hash():
                return False
            
            if current.previous_hash != previous.hash:
                return False
        
        return True
    
    def get_chain(self):
        return [block.to_dict() for block in self.chain]
    
    def save_chain(self):
        with open(self.storage_file, 'wb') as f:
            pickle.dump(self.chain, f)
    
    def load_chain(self):
        if os.path.exists(self.storage_file):
            try:
                with open(self.storage_file, 'rb') as f:
                    return pickle.load(f)
            except:
                return [self.create_genesis_block()]
        return [self.create_genesis_block()]
