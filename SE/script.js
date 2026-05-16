var isAuthenticated = false;
var currentUser = null;

function navigateTo(page) {
    var pub = ["welcome","login","signup"];
    if (!isAuthenticated && pub.indexOf(page) === -1) page = "welcome";
    var el = document.getElementById(page + "-page");
    if (!el) return;
    document.querySelectorAll(".page").forEach(function(p){ p.classList.remove("active"); });
    el.classList.add("active");
    var nav = document.querySelector(".navbar");
    nav.style.display = pub.indexOf(page) !== -1 ? "none" : "block";
    document.querySelectorAll(".nav-link").forEach(function(l){ l.classList.remove("active"); });
    var a = document.querySelector(".nav-link[data-page='" + page + "']");
    if (a) a.classList.add("active");
    if (page === "home") loadStats();
    if (page === "documents") loadDocuments();
    if (page === "blockchain") loadBlockchain();
}
window.navigateTo = navigateTo;

function handleLogin(e) {
    e.preventDefault();
    var email = document.getElementById("loginEmail").value;
    var pass = document.getElementById("loginPassword").value;
    if (!email || !pass) { alert("Please enter email and password"); return false; }
    currentUser = { email: email, name: email.split("@")[0] };
    isAuthenticated = true;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    updateAuthUI();
    navigateTo("home");
    return false;
}

function handleSignup(e) {
    e.preventDefault();
    var name = document.getElementById("signupName").value;
    var email = document.getElementById("signupEmail").value;
    var pass = document.getElementById("signupPassword").value;
    var conf = document.getElementById("signupConfirmPassword").value;
    if (pass !== conf) { alert("Passwords do not match!"); return false; }
    if (!name || !email || !pass) { alert("Please fill all fields"); return false; }
    currentUser = { email: email, name: name };
    isAuthenticated = true;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    updateAuthUI();
    navigateTo("home");
    return false;
}
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;

function logout() {
    isAuthenticated = false;
    currentUser = null;
    localStorage.removeItem("currentUser");
    navigateTo("welcome");
}
window.logout = logout;

function loadExample(type) {
    navigateTo('analyze');
    setTimeout(function() {
        var examples = {
            semantic: {
                a: "The company reported record profits this quarter.",
                b: "The company is facing severe financial losses and may file for bankruptcy."
            },
            logical: {
                a: "All employees must attend the meeting. John is an employee.",
                b: "John will not attend the meeting because he has other commitments."
            },
            numeric: {
                a: "The project budget is $50,000 and we've spent $30,000 so far.",
                b: "We have already exceeded the project budget by $10,000."
            },
            temporal: {
                a: "The contract was signed on January 15, 2024 and expires after 6 months.",
                b: "The contract is still valid as of September 2024."
            }
        };
        var ex = examples[type];
        if (ex) {
            document.getElementById('statementA').value = ex.a;
            document.getElementById('statementB').value = ex.b;
        }
    }, 100);
}
window.loadExample = loadExample;

function updateAuthUI() {
    if (!currentUser) return;
    var ab = document.querySelector(".auth-buttons");
    if (ab) ab.innerHTML = '<span style="color:var(--gray)">Welcome, ' + currentUser.name + '!</span><button class="btn-auth" onclick="logout()">Logout</button>';
}

function checkAuth() {
    var u = localStorage.getItem("currentUser");
    if (u) {
        isAuthenticated = true;
        currentUser = JSON.parse(u);
        updateAuthUI();
        navigateTo("home");
    } else {
        navigateTo("welcome");
    }
}

async function analyzeText() {
    if (!isAuthenticated) { navigateTo("login"); return; }
    var a = document.getElementById("statementA").value.trim();
    var b = document.getElementById("statementB").value.trim();
    if (!a || !b) { alert("Please enter both statements"); return; }
    var btn = document.getElementById("analyzeBtn");
    btn.disabled = true; btn.innerHTML = "<span class='btn-icon'>⏳</span> Analyzing...";
    try {
        var r = await fetch("/analyze", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({statement_a:a, statement_b:b}) });
        var data = await r.json();
        displayResult(data);
    } catch(err) { alert("Error: " + err.message); }
    finally { btn.disabled = false; btn.innerHTML = "<span class='btn-icon'>🔍</span> Analyze Contradiction"; }
}

function normalizeConf(c) {
    if (c > 1) c = 1 / (1 + Math.exp(-c));
    return Math.max(0, Math.min(1, c));
}

function displayResult(data) {
    var result = data.result, block = data.block, diff = data.diff;
    document.getElementById("resultSection").style.display = "block";
    var badge = document.getElementById("contradictionBadge");
    badge.textContent = result.contradiction === "Yes" ? "⚠️ Contradiction Detected" : "✅ No Contradiction";
    badge.className = result.contradiction === "Yes" ? "badge contradiction" : "badge no-contradiction";
    
    var relText = result.relationship || "";
    if (result.contradiction_type && result.contradiction === "Yes") {
        relText = "Type: " + result.contradiction_type;
    }
    document.getElementById("relationshipType").textContent = relText;
    
    var conf = normalizeConf(result.confidence);
    var pct = (conf * 100).toFixed(1);
    document.getElementById("confidenceBar").style.width = pct + "%";
    document.getElementById("confidenceValue").textContent = pct + "%";
    if (result.semantic_similarity !== undefined)
        document.getElementById("semanticSimilarity").textContent = (result.semantic_similarity * 100).toFixed(1) + "%";
    var h = document.getElementById("blockHash");
    h.textContent = block.hash.substring(0,12) + "..." + block.hash.slice(-4);
    h.title = block.hash;
    var cv = document.getElementById("chainValid");
    cv.textContent = data.chain_valid ? "✓ Valid" : "✗ Invalid";
    cv.style.color = data.chain_valid ? "var(--success)" : "var(--danger)";
    document.getElementById("explanationText").textContent = result.explanation || "";
    if (diff) displayDiff(diff, "wordDiffCard", "wordDiffContent");
    document.getElementById("resultSection").scrollIntoView({behavior:"smooth"});
}

function displayDiff(diff, cardId, contentId) {
    var card = document.getElementById(cardId);
    var content = document.getElementById(contentId);
    if (!card || !content) return;
    var del = diff.completely_deleted || [], add = diff.completely_added || [], mod = diff.modified_lines || [];
    if (!del.length && !add.length && !mod.length) { card.style.display = "none"; return; }
    card.style.display = "block";
    content.innerHTML = '<div class="diff-section"><h4>📝 Summary</h4><p style="color:var(--gray)">' + del.length + ' deleted &nbsp;•&nbsp; ' + add.length + ' added &nbsp;•&nbsp; ' + mod.length + ' modified</p></div>';
    del.forEach(function(item) {
        content.innerHTML += '<div class="diff-section" style="border-left-color:var(--danger)"><h4>❌ Deleted Line ' + item.line_num + '</h4><div style="padding:.75rem;background:rgba(239,68,68,.1);border-radius:6px;font-family:monospace;color:var(--gray);text-decoration:line-through">' + escHtml(item.content) + '</div></div>';
    });
    add.forEach(function(item) {
        content.innerHTML += '<div class="diff-section" style="border-left-color:var(--success)"><h4>✅ Added Line ' + item.line_num + '</h4><div style="padding:.75rem;background:rgba(16,185,129,.1);border-radius:6px;font-family:monospace;color:var(--gray)">' + escHtml(item.content) + '</div></div>';
    });
    mod.forEach(function(item) {
        var rw = (item.removed_words||[]).map(function(w){ return '<span style="display:inline-block;padding:.2rem .5rem;margin:.2rem;background:rgba(239,68,68,.2);color:var(--danger);border-radius:4px;text-decoration:line-through">' + escHtml(w) + '</span>'; }).join("");
        var aw = (item.added_words||[]).map(function(w){ return '<span style="display:inline-block;padding:.2rem .5rem;margin:.2rem;background:rgba(16,185,129,.2);color:var(--success);border-radius:4px">' + escHtml(w) + '</span>'; }).join("");
        content.innerHTML += '<div class="diff-section" style="border-left-color:var(--warning)"><h4>🔄 Modified Line ' + item.old_line_num + '</h4>' +
            '<div style="margin-bottom:.5rem"><span style="color:var(--danger);font-size:.8rem;font-weight:600">OLD: </span><span style="font-family:monospace;color:var(--gray)">' + escHtml(item.old_content) + '</span></div>' +
            '<div style="margin-bottom:.5rem"><span style="color:var(--success);font-size:.8rem;font-weight:600">NEW: </span><span style="font-family:monospace;color:var(--gray)">' + escHtml(item.new_content) + '</span></div>' +
            (rw ? '<div><strong style="color:var(--danger)">Removed:</strong> ' + rw + '</div>' : '') +
            (aw ? '<div style="margin-top:.25rem"><strong style="color:var(--success)">Added:</strong> ' + aw + '</div>' : '') +
            '</div>';
    });
}

function escHtml(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

async function loadStats() {
    try {
        var r1 = await fetch("/blockchain"), r2 = await fetch("/documents");
        var bc = await r1.json(), docs = await r2.json();
        document.getElementById("totalBlocks").textContent = bc.length || bc.chain?.length || 0;
        document.getElementById("totalAnalyses").textContent = Math.max(0, (bc.length || bc.chain?.length || 1) - 1);
        document.getElementById("totalDocs").textContent = docs.documents.length;
    } catch(e) {}
}

async function loadDocuments() {
    try {
        var r = await fetch("/documents"), data = await r.json();
        var c = document.getElementById("documentsList");
        c.innerHTML = "";
        if (!data.documents.length) { c.innerHTML = '<p style="color:var(--gray);text-align:center;padding:2rem">No documents tracked yet</p>'; return; }
        data.documents.forEach(function(doc) {
            var d = document.createElement("div");
            d.className = "doc-card doc-card-clickable";
            d.onclick = function(){ viewDocumentHistory(doc.name); };
            d.innerHTML = '<h4>📄 ' + doc.name + '</h4><p><strong>Versions:</strong> ' + doc.versions + '</p><p><strong>Latest:</strong> ' + (doc.latest ? new Date(doc.latest.timestamp).toLocaleString() : "N/A") + '</p>';
            c.appendChild(d);
        });
    } catch(e) {}
}

async function viewDocumentHistory(docName) {
    window.currentDocumentName = docName;
    try {
        var r = await fetch("/document/" + encodeURIComponent(docName) + "/versions");
        var data = await r.json();
        document.getElementById("documentHistoryModal").style.display = "flex";
        document.getElementById("historyDocName").textContent = "📄 " + docName + " - Version History";
        var c = document.getElementById("documentHistoryContent");
        c.innerHTML = "";
        if (!data.versions.length) { c.innerHTML = '<p style="color:var(--gray);text-align:center;padding:2rem">No versions found</p>'; return; }
        var bcr = await fetch("/blockchain"), bcd = await bcr.json();
        var docBlocks = bcd.chain.filter(function(b){ return b.data.type === "version_comparison" && (b.data.statement_a.includes(docName) || b.data.statement_b.includes(docName)); });
        data.versions.forEach(function(version, idx) {
            var el = document.createElement("div");
            el.className = "version-history-item";
            var be = docBlocks.find(function(b){ return b.data.statement_b.includes("Version " + version.version); });
            var info = "";
            if (be) {
                var conf = normalizeConf(be.data.confidence);
                var isC = be.data.contradiction === "Yes";
                info = '<div class="version-details">' +
                    '<div class="version-detail"><span class="version-detail-label">Contradiction</span><span class="version-detail-value ' + (isC?"contradiction":"no-contradiction") + '">' + (isC?"⚠️ Yes":"✅ No") + '</span></div>' +
                    '<div class="version-detail"><span class="version-detail-label">Confidence</span><span class="version-detail-value">' + (conf*100).toFixed(1) + '%</span></div>' +
                    '<div class="version-detail"><span class="version-detail-label">Changes</span><span class="version-detail-value">' + (be.data.changes||0) + '</span></div>' +
                    '</div><div class="version-changes-summary">' +
                    '<div class="version-change-item"><span class="version-change-number" style="color:var(--success)">' + (be.data.additions||0) + '</span><span class="version-change-label">Added</span></div>' +
                    '<div class="version-change-item"><span class="version-change-number" style="color:var(--danger)">' + (be.data.deletions||0) + '</span><span class="version-change-label">Deleted</span></div>' +
                    '</div>';
            } else if (idx === 0) {
                info = '<div class="version-details"><div class="version-detail"><span class="version-detail-label">Status</span><span class="version-detail-value no-contradiction">✅ Baseline</span></div></div>';
            }
            el.innerHTML = '<div class="version-header"><span class="version-title">Version ' + version.version + '</span><div style="display:flex;gap:1rem;align-items:center"><span class="version-date">' + new Date(version.timestamp).toLocaleString() + '</span><button class="btn-delete-version" onclick="deleteVersion(\'' + docName + '\',' + version.version + ')">🗑️ Delete</button></div></div><p style="color:var(--gray);margin:.5rem 0"><strong>File:</strong> ' + version.filename + '</p>' + info;
            c.appendChild(el);
        });
    } catch(e) { alert("Error loading history"); }
}
window.viewDocumentHistory = viewDocumentHistory;

async function deleteVersion(docName, vNum) {
    if (!confirm("Delete Version " + vNum + " of \"" + docName + "\"?")) return;
    var r = await fetch("/document/" + encodeURIComponent(docName) + "/version/" + vNum, {method:"DELETE"});
    if (r.ok) { viewDocumentHistory(docName); loadDocuments(); }
    else { var e = await r.json(); alert("Error: " + e.detail); }
}
window.deleteVersion = deleteVersion;

async function deleteEntireDocument() {
    var n = window.currentDocumentName;
    if (!confirm("Delete ALL versions of \"" + n + "\"? This cannot be undone!")) return;
    var r = await fetch("/document/" + encodeURIComponent(n), {method:"DELETE"});
    if (r.ok) { closeDocumentHistory(); loadDocuments(); }
    else { var e = await r.json(); alert("Error: " + e.detail); }
}
window.deleteEntireDocument = deleteEntireDocument;

function closeDocumentHistory() { document.getElementById("documentHistoryModal").style.display = "none"; }
window.closeDocumentHistory = closeDocumentHistory;

async function loadBlockchain() {
    try {
        var r = await fetch("/blockchain"), data = await r.json();
        var c = document.getElementById("blockchainContainer");
        c.innerHTML = "";
        var chain = data.chain.slice().reverse();
        chain.forEach(function(block) {
            var el = document.createElement("div");
            el.className = block.index === 0 ? "block genesis" : "block";
            var type = "";
            if (block.data.type === "document_comparison") type = '<span style="color:#3b82f6;font-weight:600">📄 Document Comparison</span>';
            else if (block.data.type === "version_comparison") type = '<span style="color:#8b5cf6;font-weight:600">🔄 Version Tracking</span>';
            else if (block.data.type === "text_comparison") type = '<span style="color:#10b981;font-weight:600">📝 Text Comparison</span>';
            var delBtn = block.index !== 0 ? '<button class="block-delete-btn" onclick="deleteBlock(' + block.index + ')">🗑️ Delete</button>' : "";
            var viewBtn = block.index !== 0 ? '<button class="block-view-btn" onclick="viewBlockDetails(' + block.index + ')">👁️ View</button>' : "";
            el.innerHTML = delBtn + viewBtn + '<div class="block-header"><span>Block #' + block.index + '</span><span>' + new Date(block.timestamp).toLocaleString() + '</span></div><div class="block-data">' + (type?"<div>"+type+"</div>":"") + '<div><strong>Statement A:</strong> ' + block.data.statement_a + '</div><div><strong>Statement B:</strong> ' + block.data.statement_b + '</div><div><strong>Contradiction:</strong> ' + block.data.contradiction + '</div><div><strong>Hash:</strong> <span class="hash">' + block.hash + '</span></div></div>';
            c.appendChild(el);
        });
    } catch(e) {}
}

async function viewBlockDetails(idx) {
    try {
        var r = await fetch("/blockchain"), data = await r.json();
        var block = data.chain.find(function(b){ return b.index === idx; });
        if (!block) { alert("Block not found"); return; }
        
        document.getElementById("blockDetailModal").style.display = "flex";
        document.getElementById("blockDetailTitle").textContent = "Block #" + block.index + " - Details";
        
        var content = document.getElementById("blockDetailContent");
        var isC = block.data.contradiction === "Yes";
        var conf = normalizeConf(block.data.confidence || 0);
        
        content.innerHTML = '<div class="result-grid">' +
            '<div class="result-card-main">' +
            '<div class="result-header">' +
            '<span class="badge ' + (isC ? 'contradiction' : 'no-contradiction') + '">' + (isC ? '⚠️ Contradiction Detected' : '✅ No Contradiction') + '</span>' +
            '<span class="relationship-type">' + (block.data.relationship || block.data.type || '') + '</span>' +
            '</div>' +
            '<div class="result-confidence">' +
            '<div class="confidence-label">Confidence Score</div>' +
            '<div class="confidence-bar"><div class="confidence-fill" style="width:' + (conf*100).toFixed(1) + '%"></div></div>' +
            '<div class="confidence-value">' + (conf*100).toFixed(1) + '%</div>' +
            '</div></div>' +
            '<div class="result-card-secondary">' +
            (block.data.semantic_similarity ? '<div class="metric"><span class="metric-label">Semantic Similarity</span><span class="metric-value">' + (block.data.semantic_similarity*100).toFixed(1) + '%</span></div>' : '') +
            (block.data.changes ? '<div class="metric"><span class="metric-label">Total Changes</span><span class="metric-value">' + block.data.changes + '</span></div>' : '') +
            '<div class="metric"><span class="metric-label">Timestamp</span><span class="metric-value">' + new Date(block.timestamp).toLocaleString() + '</span></div>' +
            '</div></div>' +
            '<div class="explanation-card"><h3>📊 Analysis</h3>' +
            '<p><strong>Statement A:</strong> ' + block.data.statement_a + '</p>' +
            '<p><strong>Statement B:</strong> ' + block.data.statement_b + '</p>' +
            (block.data.explanation ? '<p style="margin-top:1rem;color:var(--gray)">' + block.data.explanation + '</p>' : '') +
            '</div>' +
            (block.data.additions || block.data.deletions ? '<div class="changes-card"><h3>📝 Changes</h3><div class="changes-grid">' +
            '<div class="change-stat additions"><span class="change-number">' + (block.data.additions||0) + '</span><span class="change-label">Additions</span></div>' +
            '<div class="change-stat deletions"><span class="change-number">' + (block.data.deletions||0) + '</span><span class="change-label">Deletions</span></div>' +
            '</div></div>' : '') +
            '<div style="margin-top:1rem;padding:1rem;background:rgba(255,255,255,0.05);border-radius:8px;font-family:monospace;font-size:0.85rem;word-break:break-all"><strong>Hash:</strong> ' + block.hash + '</div>';
    } catch(e) { alert("Error loading block details"); }
}
window.viewBlockDetails = viewBlockDetails;

function closeBlockDetail() { document.getElementById("blockDetailModal").style.display = "none"; }
window.closeBlockDetail = closeBlockDetail;

async function deleteBlock(idx) {
    if (!confirm("Delete Block #" + idx + "?")) return;
    var r = await fetch("/blockchain/block/" + idx, {method:"DELETE"});
    if (r.ok) loadBlockchain();
    else { var e = await r.json(); alert("Error: " + e.detail); }
}
window.deleteBlock = deleteBlock;

async function clearBlockchain() {
    if (!confirm("Clear ALL blockchain history? Cannot be undone!")) return;
    if (!confirm("FINAL WARNING: Delete all blocks?")) return;
    var r = await fetch("/blockchain/clear", {method:"DELETE"});
    if (r.ok) loadBlockchain();
}

async function analyzeDocuments() {
    if (!isAuthenticated) { navigateTo("login"); return; }
    var fa = document.getElementById("fileA").files[0], fb = document.getElementById("fileB").files[0];
    if (!fa || !fb) { alert("Please select both documents"); return; }
    var btn = document.getElementById("analyzeDocsBtn");
    btn.disabled = true; btn.innerHTML = "<span class='btn-icon'>⏳</span> Analyzing...";
    try {
        var fd = new FormData(); fd.append("file_a", fa); fd.append("file_b", fb);
        var r = await fetch("/analyze-documents", {method:"POST", body:fd});
        var data = await r.json();
        displayResult(data);
        if (data.diff) {
            document.getElementById("changesCard").style.display = "block";
            document.getElementById("totalChanges").textContent = data.diff.total_changes;
            document.getElementById("additions").textContent = (data.diff.completely_added||data.diff.additions||[]).length;
            document.getElementById("deletions").textContent = (data.diff.completely_deleted||data.diff.deletions||[]).length;
        }
    } catch(e) { alert("Error: " + e.message); }
    finally { btn.disabled = false; btn.innerHTML = "<span class='btn-icon'>📄</span> Compare Documents"; }
}

async function uploadVersion() {
    if (!isAuthenticated) { navigateTo("login"); return; }
    var name = document.getElementById("docName").value.trim();
    var file = document.getElementById("versionFile").files[0];
    if (!name || !file) { alert("Please enter document name and select a file"); return; }
    var btn = document.getElementById("uploadVersionBtn");
    btn.disabled = true; btn.innerHTML = "<span class='btn-icon'>⏳</span> Uploading...";
    try {
        var fd = new FormData(); fd.append("file", file); fd.append("doc_name", name);
        var r = await fetch("/upload-version", {method:"POST", body:fd});
        var data = await r.json();
        displayVersionResult(data, name);
        document.getElementById("docName").value = "";
        document.getElementById("versionFile").value = "";
        document.getElementById("versionFileName").textContent = "Choose file (PDF, DOCX, TXT)";
        loadDocuments();
    } catch(e) { alert("Error: " + e.message); }
    finally { btn.disabled = false; btn.innerHTML = "<span class='btn-icon'>⬆️</span> Upload Version"; }
}

function displayVersionResult(data, docName) {
    var sec = document.getElementById("versionResultSection");
    sec.style.display = "block";
    document.getElementById("versionDocName").textContent = docName;
    document.getElementById("versionNum").textContent = "Version " + data.version;
    if (data.contradiction) {
        var isC = data.contradiction.contradiction === "Yes";
        var badge = document.getElementById("versionBadge");
        badge.textContent = isC ? "⚠️ Changes Detected" : "✅ No Contradictions";
        badge.className = isC ? "badge contradiction" : "badge no-contradiction";
        var conf = normalizeConf(data.contradiction.confidence);
        var pct = (conf * 100).toFixed(1);
        document.getElementById("versionConfidenceBar").style.width = pct + "%";
        document.getElementById("versionConfidenceValue").textContent = pct + "%";
        document.getElementById("versionNumber").textContent = "Compared with Version " + (data.version - 1);
        if (data.diff) {
            document.getElementById("versionChanges").textContent = data.diff.total_changes;
            document.getElementById("versionTotalChanges").textContent = data.diff.total_changes;
            document.getElementById("versionAdditions").textContent = (data.diff.completely_added||data.diff.additions||[]).length;
            document.getElementById("versionDeletions").textContent = (data.diff.completely_deleted||data.diff.deletions||[]).length;
            displayDiff(data.diff, "versionDiffCard", "versionDiffContent");
        }
        document.getElementById("versionExplanation").textContent = isC
            ? "Version " + data.version + " contains " + (data.diff?.total_changes||0) + " changes. Contradictions detected with " + pct + "% confidence."
            : "Version " + data.version + " uploaded. No contradictions detected.";
    } else {
        document.getElementById("versionBadge").textContent = "✅ First Version Uploaded";
        document.getElementById("versionBadge").className = "badge no-contradiction";
        document.getElementById("versionConfidenceBar").style.width = "0%";
        document.getElementById("versionConfidenceValue").textContent = "N/A";
        document.getElementById("versionNumber").textContent = "Baseline Version";
        document.getElementById("versionChanges").textContent = "0";
        document.getElementById("versionTotalChanges").textContent = "0";
        document.getElementById("versionAdditions").textContent = "0";
        document.getElementById("versionDeletions").textContent = "0";
        document.getElementById("versionDiffCard").style.display = "none";
        document.getElementById("versionExplanation").textContent = "This is the first version of \"" + docName + "\". Future uploads will be compared against this baseline.";
    }
    sec.scrollIntoView({behavior:"smooth"});
}

async function compareDocs() {
    if (!isAuthenticated) { navigateTo("login"); return; }
    var fa = document.getElementById("compareFileA").files[0], fb = document.getElementById("compareFileB").files[0];
    if (!fa || !fb) { alert("Please select both documents"); return; }
    var btn = document.getElementById("compareDocsBtn");
    btn.disabled = true; btn.innerHTML = "<span class='btn-icon'>⏳</span> Generating Report...";
    try {
        var fd = new FormData(); fd.append("file_a", fa); fd.append("file_b", fb);
        var r = await fetch("/analyze-documents", {method:"POST", body:fd});
        var data = await r.json();
        displayCompareResult(data, fa.name, fb.name);
    } catch(e) { alert("Error: " + e.message); }
    finally { btn.disabled = false; btn.innerHTML = "<span class='btn-icon'>📊</span> Generate Report"; }
}

function displayCompareResult(data, nameA, nameB) {
    var result = data.result, block = data.block, diff = data.diff;
    document.getElementById("compareResultSection").style.display = "block";
    var badge = document.getElementById("compareBadge");
    badge.textContent = result.contradiction === "Yes" ? "⚠️ Contradiction Detected" : "✅ No Contradiction";
    badge.className = result.contradiction === "Yes" ? "badge contradiction" : "badge no-contradiction";
    document.getElementById("compareRelationship").textContent = result.relationship || "";
    var conf = normalizeConf(result.confidence);
    var pct = (conf * 100).toFixed(1);
    document.getElementById("compareConfidenceBar").style.width = pct + "%";
    document.getElementById("compareConfidenceValue").textContent = pct + "%";
    if (result.semantic_similarity !== undefined)
        document.getElementById("compareSemanticSimilarity").textContent = (result.semantic_similarity * 100).toFixed(1) + "%";
    document.getElementById("compareTotalChanges").textContent = diff?.total_changes || 0;
    var h = document.getElementById("compareBlockHash");
    h.textContent = block.hash.substring(0,12) + "..." + block.hash.slice(-4);
    h.title = block.hash;
    document.getElementById("compareExplanation").textContent = "Comparing \"" + nameA + "\" vs \"" + nameB + "\": " + (result.explanation || "");
    if (diff) {
        document.getElementById("compareChangesTotal").textContent = diff.total_changes;
        document.getElementById("compareChangesAdded").textContent = (diff.completely_added||diff.additions||[]).length;
        document.getElementById("compareChangesDeleted").textContent = (diff.completely_deleted||diff.deletions||[]).length;
        displayDiff(diff, "compareDiffCard", "compareDiffContent");
    }
    document.getElementById("compareResultSection").scrollIntoView({behavior:"smooth"});
}

document.addEventListener("DOMContentLoaded", function() {
    checkAuth();

    el = document.getElementById("loginForm");
    if (el) el.addEventListener("submit", handleLogin);

    el = document.getElementById("signupForm");
    if (el) el.addEventListener("submit", handleSignup);

    el = document.getElementById("analyzeBtn");
    if (el) el.onclick = analyzeText;

    el = document.getElementById("analyzeDocsBtn");
    if (el) el.onclick = analyzeDocuments;

    el = document.getElementById("uploadVersionBtn");
    if (el) el.onclick = uploadVersion;

    el = document.getElementById("compareDocsBtn");
    if (el) el.onclick = compareDocs;

    el = document.getElementById("refreshBtn");
    if (el) el.onclick = loadBlockchain;

    el = document.getElementById("clearBlockchainBtn");
    if (el) el.onclick = clearBlockchain;

    document.querySelectorAll(".nav-link").forEach(function(link) {
        link.addEventListener("click", function(e) {
            e.preventDefault();
            var page = this.getAttribute("data-page");
            if (page) navigateTo(page);
        });
    });

    document.querySelectorAll(".tab-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
            var tab = this.getAttribute("data-tab");
            document.querySelectorAll(".tab-btn").forEach(function(b){ b.classList.remove("active"); });
            this.classList.add("active");
            document.querySelectorAll(".tab-content").forEach(function(t){ t.classList.remove("active"); });
            document.getElementById(tab + "-tab").classList.add("active");
        });
    });

    [["fileA","fileAName"],["fileB","fileBName"],["versionFile","versionFileName"],["compareFileA","compareFileAName"],["compareFileB","compareFileBName"]].forEach(function(pair) {
        var inp = document.getElementById(pair[0]);
        if (inp) inp.onchange = function(){ document.getElementById(pair[1]).textContent = this.files[0]?.name || "Choose file (PDF, DOCX, TXT)"; };
    });

    var modal = document.getElementById("documentHistoryModal");
    if (modal) modal.addEventListener("click", function(e){ if (e.target === modal) closeDocumentHistory(); });
    
    var blockModal = document.getElementById("blockDetailModal");
    if (blockModal) blockModal.addEventListener("click", function(e){ if (e.target === blockModal) closeBlockDetail(); });
});
