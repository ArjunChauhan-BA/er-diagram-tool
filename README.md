# ERGen — AI-Powered ER Diagram Generator

A fully local, zero-cost ER diagram tool powered by Ollama (local LLM). No cloud APIs, no subscriptions.

---

## Features

- **Three input methods**: type a prompt, upload Excel (.xlsx/.xls), or upload CSV
- **AI-powered parsing** via Ollama (llama3/mistral/phi3) — runs 100% locally
- **Automatic fallback** to local parser if Ollama is offline
- **Visual ER diagram** with D3.js: tables, columns, PK/FK badges, relationship lines
- **Drag tables** to rearrange the layout
- **Collapse/expand** individual tables
- **Zoom & pan** with keyboard-friendly toolbar
- **Export** as standalone SVG or HTML file

---

## Quick Start

### Prerequisites
- Python 3.8 or higher
- (Optional but recommended) [Ollama](https://ollama.com) installed

### Step 1 — Install Ollama (recommended)

**macOS / Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3
ollama serve   # keep this running in a terminal
```

**Windows:**
Download the installer from https://ollama.com/download

Then in a terminal:
```cmd
ollama pull llama3
```
Ollama runs as a background service on Windows automatically after install.

---

### Step 2 — Run ERGen

**macOS / Linux:**
```bash
chmod +x run.sh
./run.sh
```

**Windows:**
Double-click `run.bat`

**Manual (any OS):**
```bash
cd er-diagram-tool
python -m venv venv
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

pip install -r requirements.txt
python app.py
```

Open **http://localhost:5000** in your browser.

---

## Using the Tool

### Input Method 1 — Text Prompt

Type your schema in natural language. Examples:

**Simple:**
```
Table: Customers
- customer_id INT PK
- name VARCHAR(100)
- email VARCHAR(255)

Table: Orders
- order_id INT PK
- customer_id INT FK → Customers.customer_id
- total DECIMAL(10,2)
- status VARCHAR(20)
```

**Natural language (AI mode only):**
```
Create an e-commerce database with Customers (id, name, email, phone),
Products (id, name, price, stock, category_id), Categories (id, name),
Orders (id, customer_id FK, created_at, total), and OrderItems
(id, order_id FK, product_id FK, quantity, price).
```

---

### Input Method 2 — Excel / CSV Upload

Your file can have **any column structure**. Common formats that are auto-detected:

**Format A — Mapping file (7 columns):**
```
Source | SourceTable | SourceColumn | DataType | TargetSchema | TargetTable | TargetField
```

**Format B — Schema dump:**
```
TableName | ColumnName | DataType | IsPrimaryKey | IsForeignKey | ReferencesTable | ReferencesColumn
```

**Format C — Any table with column info** — the tool will auto-detect and send to the AI.

You can also add extra context in the "Optional prompt" box below the file uploader to tell the AI about specific FK relationships.

---

### Ollama Toggle

- **ON** (default): Sends your input to your local Ollama model for intelligent parsing. Best for natural language and complex schemas.
- **OFF**: Uses the built-in regex parser. Works well for structured formats (CREATE TABLE, Table: X syntax).

---

## Diagram Controls

| Action | How |
|--------|-----|
| Pan | Click and drag on empty canvas |
| Zoom | Mouse wheel or +/- buttons |
| Fit to screen | ⊡ button |
| Move a table | Drag the table card |
| Collapse a table | Click the ▼ arrow in table header |
| Focus a table | Click its name in the Schema panel (left sidebar) |
| Reset layout | ↺ button |

---

## Export

- **Export SVG** — standalone `.svg` vector file
- **Export HTML** — standalone `.html` file you can open in any browser, share, or embed

---

## Troubleshooting

**"Ollama is not running"**
→ Start Ollama: `ollama serve` (macOS/Linux) or start the Ollama app (Windows)

**"No tables found in the input"**
→ Be more explicit. Use "Table: X" format, or list column names clearly.

**LLM gives bad output**
→ Toggle off Ollama and use the local parser, or rephrase your prompt more explicitly.

**Port 5000 in use**
→ Edit `app.py` last line: change `port=5000` to `port=5001` (or any free port)

---

## Project Structure

```
er-diagram-tool/
├── app.py              # Flask backend + Ollama integration
├── requirements.txt    # Python dependencies
├── run.sh              # macOS/Linux launcher
├── run.bat             # Windows launcher
├── templates/
│   └── index.html      # Single-page app
└── static/
    ├── css/style.css   # Full UI styling
    └── js/er.js        # D3.js ER diagram engine
```

---

## Models Tested

| Model | Quality | Speed | RAM needed |
|-------|---------|-------|------------|
| llama3 (8B) | ★★★★★ | Fast | 8 GB |
| mistral (7B) | ★★★★☆ | Fast | 8 GB |
| phi3 (3.8B) | ★★★☆☆ | Very fast | 4 GB |
| gemma (7B) | ★★★★☆ | Fast | 8 GB |

To switch models: `ollama pull <model>` — the tool auto-selects the best available.
