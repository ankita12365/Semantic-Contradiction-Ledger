from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sentence_transformers import CrossEncoder, SentenceTransformer
from blockchain import Blockchain
from typing import Optional
import uvicorn
import os
import json
import PyPDF2
import docx
import difflib
from datetime import datetime
import numpy as np

app = FastAPI()
blockchain = Blockchain()

# Load NLI model for contradiction detection
model = CrossEncoder('cross-encoder/nli-deberta-v3-base')
# Load sentence transformer for semantic similarity
embedder = SentenceTransformer('all-MiniLM-L6-v2')

# Storage for document versions
UPLOAD_DIR = "uploaded_docs"
VERSIONS_FILE = "document_versions.json"
os.makedirs(UPLOAD_DIR, exist_ok=True)

class StatementPair(BaseModel):
    statement_a: str
    statement_b: str

def extract_text_from_file(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.pdf':
        with open(file_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return text.strip()
    
    elif ext in ['.docx', '.doc']:
        doc = docx.Document(file_path)
        return "\n".join([para.text for para in doc.paragraphs])
    
    elif ext == '.txt':
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    return ""

def load_document_versions():
    if os.path.exists(VERSIONS_FILE):
        with open(VERSIONS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_document_versions(versions):
    with open(VERSIONS_FILE, 'w') as f:
        json.dump(versions, f, indent=2)

def get_text_diff(text1: str, text2: str):
    # Split by sentences for better detection
    sentences1 = [s.strip() + '.' for s in text1.split('.') if s.strip()]
    sentences2 = [s.strip() + '.' for s in text2.split('.') if s.strip()]
    
    # If no sentences, fall back to lines
    if not sentences1 or not sentences2:
        lines1 = text1.splitlines()
        lines2 = text2.splitlines()
    else:
        lines1 = sentences1
        lines2 = sentences2
    
    diff = list(difflib.unified_diff(lines1, lines2, lineterm=''))
    
    additions = [line[1:] for line in diff if line.startswith('+') and not line.startswith('+++')]
    deletions = [line[1:] for line in diff if line.startswith('-') and not line.startswith('---')]
    
    # Get detailed line-by-line comparison
    matcher = difflib.SequenceMatcher(None, lines1, lines2)
    detailed_changes = []
    completely_deleted = []
    completely_added = []
    
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'delete':
            # Lines completely deleted
            for i in range(i1, i2):
                completely_deleted.append({
                    'line_num': i + 1,
                    'content': lines1[i]
                })
        elif tag == 'insert':
            # Lines completely added
            for j in range(j1, j2):
                completely_added.append({
                    'line_num': j + 1,
                    'content': lines2[j]
                })
        elif tag == 'replace':
            # Check if lines are completely different or just modified
            num_old = i2 - i1
            num_new = j2 - j1
            
            # If different number of lines, treat extras as deleted/added
            if num_old > num_new:
                # More old lines - some deleted
                for i in range(i1 + num_new, i2):
                    completely_deleted.append({
                        'line_num': i + 1,
                        'content': lines1[i]
                    })
            elif num_new > num_old:
                # More new lines - some added
                for j in range(j1 + num_old, j2):
                    completely_added.append({
                        'line_num': j + 1,
                        'content': lines2[j]
                    })
            
            # Process paired lines for word-level diff
            for idx in range(min(num_old, num_new)):
                i = i1 + idx
                j = j1 + idx
                old_line = lines1[i]
                new_line = lines2[j]
                
                # Get word-level diff
                old_words = old_line.split()
                new_words = new_line.split()
                word_matcher = difflib.SequenceMatcher(None, old_words, new_words)
                
                removed_words = []
                added_words = []
                
                for w_tag, w_i1, w_i2, w_j1, w_j2 in word_matcher.get_opcodes():
                    if w_tag == 'delete':
                        removed_words.extend(old_words[w_i1:w_i2])
                    elif w_tag == 'insert':
                        added_words.extend(new_words[w_j1:w_j2])
                    elif w_tag == 'replace':
                        removed_words.extend(old_words[w_i1:w_i2])
                        added_words.extend(new_words[w_j1:w_j2])
                
                if removed_words or added_words:
                    detailed_changes.append({
                        'old_line_num': i + 1,
                        'new_line_num': j + 1,
                        'old_content': old_line,
                        'new_content': new_line,
                        'removed_words': removed_words,
                        'added_words': added_words
                    })
    
    return {
        "additions": additions,
        "deletions": deletions,
        "total_changes": len(completely_deleted) + len(completely_added) + len(detailed_changes),
        "completely_deleted": completely_deleted,
        "completely_added": completely_added,
        "modified_lines": detailed_changes
    }

def get_word_level_diff(text_a: str, text_b: str):
    """Get word-level differences between two texts"""
    # Split into sentences first
    sentences_a = [s.strip() for s in text_a.split('.') if s.strip()]
    sentences_b = [s.strip() for s in text_b.split('.') if s.strip()]
    
    # Get sentence-level differences
    sentence_diff = list(difflib.unified_diff(sentences_a, sentences_b, lineterm=''))
    
    # Get word-level differences
    words_a = text_a.split()
    words_b = text_b.split()
    
    diff = list(difflib.ndiff(words_a, words_b))
    
    changes = []
    removed = []
    added = []
    
    for item in diff:
        if item.startswith('- '):
            word = item[2:].strip('.,!?;:')
            if word:
                removed.append(word)
        elif item.startswith('+ '):
            word = item[2:].strip('.,!?;:')
            if word:
                added.append(word)
    
    # Build summary
    summary_parts = []
    
    # Check for sentence changes
    if len(sentences_a) != len(sentences_b):
        if len(sentences_a) > len(sentences_b):
            summary_parts.append(f"{len(sentences_a) - len(sentences_b)} sentence(s) removed")
        else:
            summary_parts.append(f"{len(sentences_b) - len(sentences_a)} sentence(s) added")
    
    # Word changes
    if removed:
        summary_parts.append(f"{len(removed)} word(s) removed")
    if added:
        summary_parts.append(f"{len(added)} word(s) added")
    
    summary = ", ".join(summary_parts) if summary_parts else "No significant changes detected"
    
    # Identify word replacements (words that appear in both removed and added)
    common_positions = min(len(removed), len(added))
    for i in range(common_positions):
        if removed[i].lower() != added[i].lower():
            changes.append(f'"{removed[i]}" → "{added[i]}"')
    
    # Build detailed change description
    change_details = []
    if len(sentences_a) > len(sentences_b):
        deleted_sentences = sentences_a[len(sentences_b):]
        change_details.append(f"Deleted sentence(s): {', '.join(deleted_sentences)}")
    elif len(sentences_b) > len(sentences_a):
        added_sentences = sentences_b[len(sentences_a):]
        change_details.append(f"Added sentence(s): {', '.join(added_sentences)}")
    
    return {
        "removed_words": removed,
        "added_words": added,
        "changes": changes,
        "summary": summary,
        "sentence_changes": change_details,
        "sentences_removed": max(0, len(sentences_a) - len(sentences_b)),
        "sentences_added": max(0, len(sentences_b) - len(sentences_a))
    }

def analyze_contradiction_detailed(text_a: str, text_b: str):
    # Get NLI prediction - returns logits for [contradiction, entailment, neutral]
    scores = model.predict([(text_a, text_b)])
    if hasattr(scores, 'shape') and len(scores.shape) > 0:
        raw_score = float(scores.flatten()[0])
    else:
        raw_score = float(scores)
    
    # Apply sigmoid to normalize to 0-1 range
    def sigmoid(x):
        return 1 / (1 + np.exp(-x))
    
    normalized_score = sigmoid(raw_score)
    
    # Get semantic similarity
    embeddings = embedder.encode([text_a, text_b])
    similarity = float(np.dot(embeddings[0], embeddings[1]) / 
                      (np.linalg.norm(embeddings[0]) * np.linalg.norm(embeddings[1])))
    
    # Use the same rich diff as document comparison
    diff = get_text_diff(text_a, text_b)
    
    # Determine relationship
    is_contradiction = normalized_score > 0.5
    confidence = normalized_score
    
    # Detect contradiction type
    contradiction_type = detect_contradiction_type(text_a, text_b, diff)
    
    if is_contradiction:
        if similarity > 0.7:
            explanation = f"The statements discuss similar topics but express opposite meanings. Semantic similarity: {similarity:.2%}, indicating they're about the same subject but contradict each other."
        else:
            explanation = f"The statements contradict each other with low semantic overlap ({similarity:.2%}), suggesting they make opposing claims about different aspects."
        relationship = "Contradiction"
        if contradiction_type:
            relationship += f" ({contradiction_type})"
    elif similarity > 0.8:
        explanation = f"The statements are highly similar ({similarity:.2%}) and express consistent meanings. They likely support or paraphrase each other."
        relationship = "Entailment/Agreement"
    else:
        explanation = f"The statements are neutral with moderate similarity ({similarity:.2%}). They neither contradict nor strongly support each other."
        relationship = "Neutral"
    
    return {
        "contradiction": "Yes" if is_contradiction else "No",
        "confidence": round(confidence, 4),
        "semantic_similarity": round(similarity, 4),
        "explanation": explanation,
        "relationship": relationship,
        "contradiction_type": contradiction_type,
        "diff": diff
    }

def detect_contradiction_type(text_a: str, text_b: str, diff):
    """Detect the type of contradiction between two texts"""
    import re
    
    text_a_lower = text_a.lower()
    text_b_lower = text_b.lower()
    
    # Negation patterns
    negation_words = ['not', 'no', 'never', 'neither', 'none', 'nobody', 'nothing', 'nowhere', "n't", 'cannot', 'cant']
    has_negation_a = any(word in text_a_lower.split() for word in negation_words)
    has_negation_b = any(word in text_b_lower.split() for word in negation_words)
    
    # Check for negation contradiction (one has negation, other doesn't)
    if has_negation_a != has_negation_b:
        # Check if they're talking about the same thing
        words_a = set(text_a_lower.split()) - set(negation_words)
        words_b = set(text_b_lower.split()) - set(negation_words)
        overlap = len(words_a & words_b) / max(len(words_a), len(words_b), 1)
        if overlap > 0.5:
            return "Negation"
    
    # Numeric contradiction
    numbers_a = re.findall(r'\d+(?:\.\d+)?', text_a)
    numbers_b = re.findall(r'\d+(?:\.\d+)?', text_b)
    if numbers_a and numbers_b:
        # Check if numbers are different
        if set(numbers_a) != set(numbers_b):
            # Check if discussing same topic
            words_a = set(re.sub(r'\d+(?:\.\d+)?', '', text_a_lower).split())
            words_b = set(re.sub(r'\d+(?:\.\d+)?', '', text_b_lower).split())
            overlap = len(words_a & words_b) / max(len(words_a), len(words_b), 1)
            if overlap > 0.4:
                return "Numeric"
    
    # Temporal contradiction (dates, times, temporal words)
    temporal_words = ['before', 'after', 'earlier', 'later', 'yesterday', 'tomorrow', 'today', 'past', 'future', 'now', 'then']
    months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    
    has_temporal_a = any(word in text_a_lower for word in temporal_words + months + days)
    has_temporal_b = any(word in text_b_lower for word in temporal_words + months + days)
    
    # Check for date patterns
    date_pattern = r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}'
    dates_a = re.findall(date_pattern, text_a)
    dates_b = re.findall(date_pattern, text_b)
    
    if (has_temporal_a and has_temporal_b) or (dates_a and dates_b):
        if dates_a != dates_b or any(word in text_a_lower for word in temporal_words) != any(word in text_b_lower for word in temporal_words):
            return "Temporal"
    
    # Antonym-based contradiction
    antonym_pairs = [
        ('happy', 'sad'), ('good', 'bad'), ('hot', 'cold'), ('big', 'small'),
        ('fast', 'slow'), ('high', 'low'), ('rich', 'poor'), ('strong', 'weak'),
        ('success', 'failure'), ('win', 'lose'), ('increase', 'decrease'),
        ('profit', 'loss'), ('agree', 'disagree'), ('accept', 'reject'),
        ('healthy', 'sick'), ('alive', 'dead'), ('true', 'false'), ('right', 'wrong')
    ]
    
    for word1, word2 in antonym_pairs:
        if (word1 in text_a_lower and word2 in text_b_lower) or (word2 in text_a_lower and word1 in text_b_lower):
            return "Semantic (Antonym)"
    
    # Logical contradiction (if-then, cause-effect)
    logical_indicators = ['if', 'then', 'because', 'therefore', 'thus', 'hence', 'consequently', 'as a result', 'must', 'should', 'all', 'every', 'none', 'some']
    has_logical_a = any(word in text_a_lower for word in logical_indicators)
    has_logical_b = any(word in text_b_lower for word in logical_indicators)
    
    if has_logical_a and has_logical_b:
        return "Logical"
    
    # Entity contradiction (different entities for same role)
    # Check for proper nouns or names
    words_a = text_a.split()
    words_b = text_b.split()
    capitalized_a = [w for w in words_a if w[0].isupper() and w.lower() not in ['i', 'the', 'a', 'an']]
    capitalized_b = [w for w in words_b if w[0].isupper() and w.lower() not in ['i', 'the', 'a', 'an']]
    
    if capitalized_a and capitalized_b and set(capitalized_a) != set(capitalized_b):
        # Check if rest of sentence is similar
        words_a_lower = [w.lower() for w in words_a if not w[0].isupper()]
        words_b_lower = [w.lower() for w in words_b if not w[0].isupper()]
        overlap = len(set(words_a_lower) & set(words_b_lower)) / max(len(set(words_a_lower)), len(set(words_b_lower)), 1)
        if overlap > 0.5:
            return "Entity"
    
    # Default: General semantic contradiction
    if diff and (diff['completely_deleted'] or diff['completely_added'] or diff['modified_lines']):
        return "Semantic"
    
    return None
    
    if is_contradiction:
        if similarity > 0.7:
            explanation = f"The statements discuss similar topics but express opposite meanings. Semantic similarity: {similarity:.2%}, indicating they're about the same subject but contradict each other."
        else:
            explanation = f"The statements contradict each other with low semantic overlap ({similarity:.2%}), suggesting they make opposing claims about different aspects."
        relationship = "Contradiction"
    elif similarity > 0.8:
        explanation = f"The statements are highly similar ({similarity:.2%}) and express consistent meanings. They likely support or paraphrase each other."
        relationship = "Entailment/Agreement"
    else:
        explanation = f"The statements are neutral with moderate similarity ({similarity:.2%}). They neither contradict nor strongly support each other."
        relationship = "Neutral"
    
    return {
        "contradiction": "Yes" if is_contradiction else "No",
        "confidence": round(confidence, 4),
        "semantic_similarity": round(similarity, 4),
        "explanation": explanation,
        "relationship": relationship,
        "diff": diff
    }


@app.get("/")
def read_root():
    return FileResponse("index.html")

@app.get("/test")
def test_auth():
    return FileResponse("test_auth.html")


@app.post("/analyze")
def analyze_statements(pair: StatementPair):
    if not pair.statement_a.strip() or not pair.statement_b.strip():
        raise HTTPException(status_code=400, detail="Both statements must be non-empty")
    
    analysis = analyze_contradiction_detailed(pair.statement_a, pair.statement_b)
    
    result = {
        "statement_a": pair.statement_a[:200] + "..." if len(pair.statement_a) > 200 else pair.statement_a,
        "statement_b": pair.statement_b[:200] + "..." if len(pair.statement_b) > 200 else pair.statement_b,
        "contradiction": analysis["contradiction"],
        "confidence": analysis["confidence"],
        "type": "text_comparison",
        "explanation": analysis["explanation"],
        "semantic_similarity": analysis["semantic_similarity"],
        "relationship": analysis["relationship"],
        "contradiction_type": analysis.get("contradiction_type")
    }
    
    new_block = blockchain.add_block(result)
    blockchain.save_chain()
    
    return {
        "result": result,
        "diff": analysis["diff"],
        "block": new_block.to_dict(),
        "chain_valid": blockchain.is_valid()
    }

@app.post("/analyze-documents")
async def analyze_documents(
    file_a: Optional[UploadFile] = File(None),
    file_b: Optional[UploadFile] = File(None),
    text_a: Optional[str] = Form(None),
    text_b: Optional[str] = Form(None)
):
    content_a = text_a or ""
    content_b = text_b or ""
    
    # Extract text from uploaded files
    if file_a:
        file_path_a = os.path.join(UPLOAD_DIR, f"temp_a_{file_a.filename}")
        with open(file_path_a, 'wb') as f:
            f.write(await file_a.read())
        content_a = extract_text_from_file(file_path_a)
        os.remove(file_path_a)
    
    if file_b:
        file_path_b = os.path.join(UPLOAD_DIR, f"temp_b_{file_b.filename}")
        with open(file_path_b, 'wb') as f:
            f.write(await file_b.read())
        content_b = extract_text_from_file(file_path_b)
        os.remove(file_path_b)
    
    if not content_a.strip() or not content_b.strip():
        raise HTTPException(status_code=400, detail="Both documents must have content")
    
    # Analyze contradiction
    scores = model.predict([(content_a[:512], content_b[:512])])
    if hasattr(scores, 'shape') and len(scores.shape) > 0:
        raw_score = float(scores.flatten()[0])
    else:
        raw_score = float(scores)
    
    # Apply sigmoid to normalize
    def sigmoid(x):
        return 1 / (1 + np.exp(-x))
    
    normalized_score = sigmoid(raw_score)
    is_contradiction = normalized_score > 0.5
    confidence = normalized_score
    
    # Get semantic similarity
    embeddings = embedder.encode([content_a[:512], content_b[:512]])
    similarity = float(np.dot(embeddings[0], embeddings[1]) /
                      (np.linalg.norm(embeddings[0]) * np.linalg.norm(embeddings[1])))
    
    # Get text differences
    diff_result = get_text_diff(content_a, content_b)
    
    if is_contradiction:
        explanation = f"The documents contradict each other with {similarity:.2%} semantic similarity."
    elif similarity > 0.8:
        explanation = f"The documents are highly similar ({similarity:.2%}) and appear consistent."
    else:
        explanation = f"The documents are neutral with {similarity:.2%} semantic similarity."
    
    result = {
        "statement_a": content_a[:200] + "..." if len(content_a) > 200 else content_a,
        "statement_b": content_b[:200] + "..." if len(content_b) > 200 else content_b,
        "contradiction": "Yes" if is_contradiction else "No",
        "confidence": round(confidence, 4),
        "semantic_similarity": round(similarity, 4),
        "explanation": explanation,
        "relationship": "Contradiction" if is_contradiction else ("Entailment/Agreement" if similarity > 0.8 else "Neutral"),
        "type": "document_comparison",
        "changes": diff_result["total_changes"],
        "additions": len(diff_result["additions"]),
        "deletions": len(diff_result["deletions"])
    }
    
    new_block = blockchain.add_block(result)
    blockchain.save_chain()
    
    return {
        "result": result,
        "diff": diff_result,
        "block": new_block.to_dict(),
        "chain_valid": blockchain.is_valid()
    }

@app.post("/upload-version")
async def upload_version(
    file: UploadFile = File(...),
    doc_name: str = Form(...)
):
    # Save the uploaded file
    timestamp = datetime.now().isoformat()
    safe_name = "".join(c for c in doc_name if c.isalnum() or c in (' ', '-', '_')).strip()
    file_ext = os.path.splitext(file.filename)[1]
    version_filename = f"{safe_name}_{timestamp.replace(':', '-')}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, version_filename)
    
    with open(file_path, 'wb') as f:
        f.write(await file.read())
    
    # Extract text content
    content = extract_text_from_file(file_path)
    
    # Load existing versions
    versions = load_document_versions()
    
    if safe_name not in versions:
        versions[safe_name] = []
    
    # Check for previous version
    previous_version = None
    diff_result = None
    contradiction_result = None
    
    if versions[safe_name]:
        prev = versions[safe_name][-1]
        previous_version = prev
        prev_content = extract_text_from_file(prev["file_path"])
        
        # Get differences
        diff_result = get_text_diff(prev_content, content)
        
        # Check for contradictions
        scores = model.predict([(prev_content[:512], content[:512])])
        if hasattr(scores, 'shape') and len(scores.shape) > 0:
            raw_score = float(scores.flatten()[0])
        else:
            raw_score = float(scores)
        
        # Apply sigmoid to normalize
        def sigmoid(x):
            return 1 / (1 + np.exp(-x))
        
        normalized_score = sigmoid(raw_score)
        is_contradiction = normalized_score > 0.5
        
        contradiction_result = {
            "contradiction": "Yes" if is_contradiction else "No",
            "confidence": round(normalized_score, 4)
        }
        
        # Mine version comparison into blockchain
        block_data = {
            "statement_a": f"Version {len(versions[safe_name])} of {safe_name}",
            "statement_b": f"Version {len(versions[safe_name]) + 1} of {safe_name}",
            "contradiction": contradiction_result["contradiction"],
            "confidence": contradiction_result["confidence"],
            "type": "version_comparison",
            "changes": diff_result["total_changes"],
            "additions": len(diff_result["additions"]),
            "deletions": len(diff_result["deletions"])
        }
        
        blockchain.add_block(block_data)
        blockchain.save_chain()
    
    # Save new version
    versions[safe_name].append({
        "version": len(versions[safe_name]) + 1,
        "timestamp": timestamp,
        "file_path": file_path,
        "filename": file.filename
    })
    
    save_document_versions(versions)
    
    return {
        "message": "Version uploaded successfully",
        "document": safe_name,
        "version": len(versions[safe_name]),
        "previous_version": previous_version,
        "diff": diff_result,
        "contradiction": contradiction_result
    }

@app.get("/documents")
def get_documents():
    versions = load_document_versions()
    return {
        "documents": [
            {
                "name": doc_name,
                "versions": len(doc_versions),
                "latest": doc_versions[-1] if doc_versions else None
            }
            for doc_name, doc_versions in versions.items()
        ]
    }

@app.get("/document/{doc_name}/versions")
def get_document_versions(doc_name: str):
    versions = load_document_versions()
    if doc_name not in versions:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "document": doc_name,
        "versions": versions[doc_name]
    }

@app.delete("/document/{doc_name}")
def delete_document(doc_name: str):
    """Delete entire document and all its versions"""
    versions = load_document_versions()
    if doc_name not in versions:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete all version files
    for version in versions[doc_name]:
        if os.path.exists(version["file_path"]):
            os.remove(version["file_path"])
    
    # Remove from versions
    del versions[doc_name]
    save_document_versions(versions)
    
    return {"message": f"Document '{doc_name}' and all its versions deleted successfully"}

@app.delete("/document/{doc_name}/version/{version_num}")
def delete_document_version(doc_name: str, version_num: int):
    """Delete a specific version of a document"""
    versions = load_document_versions()
    if doc_name not in versions:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Find and delete the specific version
    version_to_delete = None
    for i, version in enumerate(versions[doc_name]):
        if version["version"] == version_num:
            version_to_delete = i
            break
    
    if version_to_delete is None:
        raise HTTPException(status_code=404, detail="Version not found")
    
    # Delete the file
    file_path = versions[doc_name][version_to_delete]["file_path"]
    if os.path.exists(file_path):
        os.remove(file_path)
    
    # Remove from versions list
    versions[doc_name].pop(version_to_delete)
    
    # If no versions left, remove the document entirely
    if len(versions[doc_name]) == 0:
        del versions[doc_name]
    
    save_document_versions(versions)
    
    return {"message": f"Version {version_num} of '{doc_name}' deleted successfully"}


@app.get("/blockchain")
def get_blockchain():
    return {
        "chain": blockchain.get_chain(),
        "length": len(blockchain.chain),
        "valid": blockchain.is_valid()
    }


@app.get("/validate")
def validate_chain():
    return {
        "valid": blockchain.is_valid(),
        "length": len(blockchain.chain)
    }

@app.delete("/blockchain/block/{block_index}")
def delete_block(block_index: int):
    """Delete a specific block from the blockchain"""
    if block_index == 0:
        raise HTTPException(status_code=400, detail="Cannot delete genesis block")
    
    if block_index >= len(blockchain.chain):
        raise HTTPException(status_code=404, detail="Block not found")
    
    # Remove the block
    blockchain.chain.pop(block_index)
    
    # Reindex and relink remaining blocks after the deleted one
    for i in range(block_index, len(blockchain.chain)):
        blockchain.chain[i].index = i
        blockchain.chain[i].previous_hash = blockchain.chain[i - 1].hash
        blockchain.chain[i].hash = blockchain.chain[i].calculate_hash()
    
    blockchain.save_chain()
    
    return {"message": f"Block {block_index} deleted and chain relinked successfully"}

@app.delete("/blockchain/clear")
def clear_blockchain():
    """Clear entire blockchain (except genesis block)"""
    # Keep only genesis block
    blockchain.chain = [blockchain.chain[0]]
    blockchain.save_chain()
    
    return {"message": "Blockchain cleared successfully (genesis block preserved)"}


# Serve static files
app.mount("/static", StaticFiles(directory="."), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
