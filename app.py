import os
import json
import re
import requests
import pandas as pd
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
ALLOWED_EXTENSIONS = {'xlsx', 'xls', 'csv'}

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3"  # fallback tries mistral, phi3

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_ollama_model():
    """Pick first available model from Ollama."""
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=5)
        if r.status_code == 200:
            models = [m['name'].split(':')[0] for m in r.json().get('models', [])]
            for preferred in ['llama3', 'llama2', 'mistral', 'phi3', 'gemma', 'qwen']:
                for m in models:
                    if m.lower().startswith(preferred):
                        return m
            if models:
                return models[0]
    except Exception:
        pass
    return OLLAMA_MODEL


def call_ollama(prompt_text):
    model = get_ollama_model()
    payload = {
        "model": model,
        "prompt": prompt_text,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 4000}
    }
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=120)
        r.raise_for_status()
        return r.json().get('response', '')
    except requests.exceptions.ConnectionError:
        raise RuntimeError("Ollama is not running. Please start it with: ollama serve")
    except Exception as e:
        raise RuntimeError(f"Ollama error: {str(e)}")


def build_extraction_prompt(raw_text):
    return f"""You are a database schema expert. Extract ALL tables, columns, primary keys, and foreign keys from the input below.

Return ONLY valid JSON — no explanation, no markdown fences, no extra text.

JSON format:
{{
  "tables": [
    {{
      "name": "TableName",
      "columns": [
        {{
          "name": "column_name",
          "type": "VARCHAR(255)",
          "primary_key": true,
          "foreign_key": null,
          "nullable": false
        }},
        {{
          "name": "fk_column",
          "type": "INT",
          "primary_key": false,
          "foreign_key": {{"references_table": "OtherTable", "references_column": "id"}},
          "nullable": true
        }}
      ]
    }}
  ]
}}

Rules:
- primary_key must be boolean true/false
- foreign_key must be null OR {{"references_table": "X", "references_column": "Y"}}
- Infer FK relationships from column names like customer_id → Customers.id
- Include ALL columns mentioned
- Use realistic SQL data types

INPUT:
{raw_text}

JSON OUTPUT:"""


def parse_json_from_llm(raw_response):
    """Robustly extract JSON from LLM response."""
    # Try direct parse
    try:
        return json.loads(raw_response.strip())
    except Exception:
        pass

    # Try to find JSON block
    patterns = [
        r'```json\s*([\s\S]+?)\s*```',
        r'```\s*([\s\S]+?)\s*```',
        r'(\{[\s\S]+\})',
    ]
    for pat in patterns:
        m = re.search(pat, raw_response, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1).strip())
            except Exception:
                continue

    raise ValueError("Could not parse JSON from LLM response")


def _col_key(name):
    return name.lower().strip().replace(' ', '').replace('_', '').replace('-', '')


def parse_dataframe_directly(df):
    """
    Directly parse a structured schema Excel/CSV into schema JSON without the LLM.
    Handles:
      Format A (ERGen): Table Name | Column Name | Data Type | PK | FK | FK References
      Format B (mapping): Source | Source Table | Source Column | Data Type | Target Schema | Target Table | Target Field
    Returns schema dict or None.
    """
    cols     = df.columns.tolist()
    col_keys = [_col_key(c) for c in cols]

    def find_col(*candidates):
        for cand in candidates:
            k = cand.lower().replace(' ', '').replace('_', '')
            for i, ck in enumerate(col_keys):
                if k == ck or ck.startswith(k) or k in ck:
                    return cols[i]
        return None

    # Format A: Table Name | Column Name | Data Type | PK | FK | FK References
    tbl_col  = find_col('tablename', 'table name', 'table')
    col_col  = find_col('columnname', 'column name', 'column', 'field')
    type_col = find_col('datatype', 'data type', 'type')
    pk_col   = find_col('pk', 'primarykey', 'primary key', 'isprimarykey')
    fk_col   = find_col('fk', 'foreignkey', 'foreign key', 'isforeignkey')
    ref_col  = find_col('fkreferences', 'fk references', 'references')

    if tbl_col and col_col:
        tables    = {}
        tbl_order = []
        for _, row in df.iterrows():
            tname = str(row[tbl_col]).strip() if pd.notna(row[tbl_col]) else ''
            cname = str(row[col_col]).strip() if col_col and pd.notna(row[col_col]) else ''
            if not tname or not cname or tname.lower() in ('nan', 'none', ''):
                continue
            dtype  = str(row[type_col]).strip() if type_col and pd.notna(row[type_col]) else 'VARCHAR(255)'
            pk_val = str(row[pk_col]).strip().upper()  if pk_col  and pd.notna(row[pk_col])  else ''
            fk_val = str(row[fk_col]).strip().upper()  if fk_col  and pd.notna(row[fk_col])  else ''
            ref    = str(row[ref_col]).strip()          if ref_col and pd.notna(row[ref_col]) else ''
            is_pk  = pk_val in ('PK', 'YES', 'Y', 'TRUE', '1', 'X')
            is_fk  = fk_val in ('FK', 'YES', 'Y', 'TRUE', '1', 'X')
            fk_ref = None
            if is_fk and ref and '.' in ref:
                parts  = ref.split('.', 1)
                fk_ref = {"references_table": parts[0].strip(), "references_column": parts[1].strip()}
            elif is_fk and ref:
                fk_ref = {"references_table": ref.strip(), "references_column": "id"}
            if tname not in tables:
                tables[tname] = []
                tbl_order.append(tname)
            tables[tname].append({
                "name": cname,
                "type": dtype if dtype.lower() not in ('nan', 'none', '') else 'VARCHAR(255)',
                "primary_key": is_pk,
                "foreign_key": fk_ref,
                "nullable": not is_pk,
            })
        if tables:
            return {"tables": [{"name": t, "columns": tables[t]} for t in tbl_order]}

    # Format B: Source Table | Source Column | Data Type | Target Table | Target Field
    src_tbl   = find_col('sourcetable', 'source table')
    tgt_tbl   = find_col('targettable', 'target table')
    tgt_fld   = find_col('targetfield', 'target field')
    src_col2  = find_col('sourcecolumn', 'source column')
    dt_col    = find_col('datatype', 'data type', 'type')

    if tgt_tbl and (tgt_fld or src_col2):
        tables    = {}
        tbl_order = []
        field_col = tgt_fld or src_col2
        for _, row in df.iterrows():
            tname = str(row[tgt_tbl]).strip() if pd.notna(row[tgt_tbl]) else ''
            cname = str(row[field_col]).strip() if pd.notna(row[field_col]) else ''
            if not tname or not cname or tname.lower() in ('nan', 'none'):
                continue
            dtype = str(row[dt_col]).strip() if dt_col and pd.notna(row[dt_col]) else 'VARCHAR(255)'
            if tname not in tables:
                tables[tname] = []
                tbl_order.append(tname)
            tables[tname].append({
                "name": cname, "type": dtype,
                "primary_key": False, "foreign_key": None, "nullable": True,
            })
        if tables:
            return {"tables": [{"name": t, "columns": tables[t]} for t in tbl_order]}

    return None


def dataframe_to_raw_text(df):
    """Fallback: convert dataframe to text for LLM when direct parse fails."""
    lines = [f"Schema file columns: {', '.join(df.columns.tolist())}", ""]
    lines.append(df.to_string(index=False))
    return "\n".join(lines)


def infer_schema_locally(raw_text):
    """
    Pure Python fallback: parse schema without LLM.
    Handles common patterns in text prompts.
    """
    tables = {}

    # Pattern: Table: X or CREATE TABLE X
    table_pattern = re.compile(
        r'(?:table\s*:?\s*|CREATE\s+TABLE\s+[`"\[]?)([A-Za-z_][A-Za-z0-9_]*)',
        re.IGNORECASE
    )
    current_table = None

    lines = raw_text.replace('\r', '\n').split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # New table declaration
        tm = table_pattern.search(line)
        if tm and ('table' in line.lower() or 'create' in line.lower()):
            tname = tm.group(1).strip().strip('`"[]')
            current_table = tname
            if tname not in tables:
                tables[tname] = []
            continue

        if current_table:
            # Column line: - colname (type) PK/FK...
            col_match = re.search(
                r'[-•*]?\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\(:,]?\s*([A-Za-z]+[\w()]*)?',
                line
            )
            if col_match:
                cname = col_match.group(1)
                ctype = col_match.group(2) or 'VARCHAR(255)'
                is_pk = bool(re.search(r'\bPK\b|\bPRIMARY\s*KEY\b', line, re.IGNORECASE))
                fk_ref = None
                fk_match = re.search(
                    r'(?:FK|FOREIGN\s*KEY|references?)\s*[-→>:\s]*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)',
                    line, re.IGNORECASE
                )
                if fk_match:
                    fk_ref = {"references_table": fk_match.group(1), "references_column": fk_match.group(2)}

                tables[current_table].append({
                    "name": cname,
                    "type": ctype,
                    "primary_key": is_pk,
                    "foreign_key": fk_ref,
                    "nullable": not is_pk
                })

    result = []
    for tname, cols in tables.items():
        if not cols:
            cols = [{"name": "id", "type": "INT", "primary_key": True, "foreign_key": None, "nullable": False}]
        result.append({"name": tname, "columns": cols})

    return {"tables": result} if result else None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/check-ollama')
def check_ollama():
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=5)
        if r.status_code == 200:
            models = [m['name'] for m in r.json().get('models', [])]
            return jsonify({"status": "ok", "models": models, "active_model": get_ollama_model()})
    except Exception:
        pass
    return jsonify({"status": "offline", "models": [], "active_model": None})


@app.route('/api/generate', methods=['POST'])
def generate():
    try:
        schema_data = None
        raw_text    = ""
        df_parsed   = None   # holds dataframe if file was uploaded

        if 'file' in request.files and request.files['file'].filename != '':
            file = request.files['file']
            if not allowed_file(file.filename):
                return jsonify({"error": "Only .xlsx, .xls, .csv files allowed"}), 400

            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)

            try:
                if filename.endswith('.csv'):
                    df_parsed = pd.read_csv(filepath)
                else:
                    df_parsed = pd.read_excel(filepath)
            except Exception as e:
                return jsonify({"error": f"Could not read file: {str(e)}"}), 400
            finally:
                try:
                    os.remove(filepath)
                except Exception:
                    pass

        prompt_text = request.form.get('prompt', '').strip()
        use_ollama  = request.form.get('use_ollama', 'true').lower() == 'true'

        # ── PRIORITY 1: If a structured schema Excel/CSV was uploaded,
        #    parse it directly — no LLM needed, no ambiguity ──
        if df_parsed is not None:
            schema_data = parse_dataframe_directly(df_parsed)
            if schema_data:
                # Validate and return immediately
                for t in schema_data['tables']:
                    if not t.get('columns'):
                        t['columns'] = [{"name": "id", "type": "INT", "primary_key": True, "foreign_key": None, "nullable": False}]
                return jsonify({"success": True, "schema": schema_data})
            # Direct parse failed — fall through to LLM with text representation
            raw_text = dataframe_to_raw_text(df_parsed)
            if prompt_text:
                raw_text = raw_text + "\n\n" + prompt_text

        elif prompt_text:
            raw_text = prompt_text

        if not raw_text:
            return jsonify({"error": "Please provide a prompt or upload a file"}), 400

        # ── PRIORITY 2: LLM or local parser for text prompts ──
        if use_ollama:
            try:
                llm_prompt   = build_extraction_prompt(raw_text)
                llm_response = call_ollama(llm_prompt)
                schema_data  = parse_json_from_llm(llm_response)
            except RuntimeError as e:
                schema_data = infer_schema_locally(raw_text)
                if not schema_data:
                    return jsonify({"error": str(e) + "\n\nAlso tried local parsing but could not extract schema."}), 500
            except ValueError:
                schema_data = infer_schema_locally(raw_text)
                if not schema_data:
                    return jsonify({"error": "LLM returned unparseable output and local parser also failed."}), 500
        else:
            schema_data = infer_schema_locally(raw_text)
            if not schema_data:
                return jsonify({"error": "Could not extract schema from input"}), 400

        if not schema_data or 'tables' not in schema_data or not schema_data['tables']:
            return jsonify({"error": "No tables found in the input. Please be more specific."}), 400

        for t in schema_data['tables']:
            if not t.get('columns'):
                t['columns'] = [{"name": "id", "type": "INT", "primary_key": True, "foreign_key": None, "nullable": False}]

        return jsonify({"success": True, "schema": schema_data})

    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


if __name__ == '__main__':
    os.makedirs('uploads', exist_ok=True)
    print("=" * 55)
    print("  ER Diagram Tool — http://localhost:5000")
    print("=" * 55)
    app.run(debug=False, port=5000)
