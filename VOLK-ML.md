Here is a complete, structured Engineering Specification and Implementation Plan tailored for an AI Coding Agent (like Cursor, Windsurf, or Bolt.new). It specifies the pluggable architecture, the localization system, and the unique "Parallel Language Mode" for educational clarity.
You can copy and paste the markdown block below directly into your AI agent's prompt or a todo.md file in your workspace.
# Engineering Specification: VOLK-ML (Vivid Online Learning Kit for Machine Learning)
## Project Overview
VOLK-ML is a client-side, zero-backend, interactive machine learning educational platform hosted on GitHub Pages. Built with React, Tailwind CSS, and React Flow, it visualizes ML pipelines as draggable blocks.
A core selling point is **bilingual accessibility**. The UI must seamlessly toggle between English and Chinese, and feature a unique **"Parallel Mode"** (showing both languages side-by-side) to help beginners map native concepts to global ML terminology.
## 1. System Architecture & Directory Structure
The codebase must be strictly decoupled to allow independent plugin contributions without modifying core files.
```text
volk-ml/
├── public/
├── src/
│   ├── assets/
│   ├── components/       # Core UI (Canvas, Layout, Sidebar, Drawers)
│   ├── context/          # Global state (Language, Pipeline JSON)
│   ├── locales/          # Central localization definitions
│   │   ├── en.json
│   │   ├── zh.json
│   │   └── parallel.json # Auto-generated or custom parallel mappings
│   ├── compiler/         # JSON-to-PyTorch Translation Engine
│   ├── plugins/          # Pluggable ML Modules Directory
│   │   ├── knn/
│   │   │   ├── manifest.json  # Node metadata and schema
│   │   │   ├── compute.ts     # Client-side JS execution logic
│   │   │   └── view.tsx       # Interactive visualizations (Framer Motion / ECharts)
│   │   └── linear_regression/
│   └── App.tsx
├── package.json
└── README.md

```
## 2. Core Implementation Requirements
### Task 2.1: Pluggable Plugin System (Dynamic Registration)
The agent must implement a dynamic registry pattern that scans src/plugins/ to populate the UI automatically.
 * **manifest.json Schema Specification:**
   Each module must self-describe its input/output requirements and UI control rendering.
   ```json
   {
     "id": "knn_node",
     "name": { "en": "K-Nearest Neighbors", "zh": "K-近邻算法" },
     "category": "Classification",
     "inputs": [{ "name": "dataset", "type": "Table" }],
     "outputs": [{ "name": "model", "type": "Model" }, { "name": "boundary", "type": "Mesh" }],
     "properties": [
       {
         "key": "k_value",
         "label": { "en": "Number of Neighbors (K)", "zh": "邻居特征数 (K)" },
         "type": "slider",
         "min": 1,
         "max": 21,
         "step": 2,
         "default": 3
       }
     ],
     "pytorch_template": "from sklearn.neighbors import KNeighborsClassifier\nmodel = KNeighborsClassifier(n_neighbors={k_value})"
   }
   
   ```
 * **Automation:** The React Flow Left-Sidebar and Right-Control Panel must dynamically map out slider UI properties using this manifest data.
### Task 2.2: Localization & Parallel Language Engine
Implement an advanced custom localization system supporting three states: en, zh, and parallel.
 * **Language State Type:**
   ```typescript
   type LanguageMode = 'en' | 'zh' | 'parallel';
   
   ```
 * **The Translation Component/Hook Custom Behavior:**
   Create a useVividTranslation hook that handles rendering rules for parallel texts globally.
   ```typescript
   // Pseudocode logic for the translation hook
   function t(key: LocalizedStringObject) {
     if (currentMode === 'zh') return key.zh;
     if (currentMode === 'en') return key.en;
     if (currentMode === 'parallel') {
       // Renders "Concept Name (English Terminology)"
       return `${key.zh} (${key.en})`; 
     }
   }
   
   ```
 * **UI Constraints:** Text boxes and layout nodes must use Tailwind CSS flexbox setups that adapt to longer string dimensions when parallel mode is active without clipping contents.
### Task 2.3: JSON-to-PyTorch Compilation Engine
Create a utility function in src/compiler/compiler.ts that traverses the active React Flow canvas object graph.
 * **Input:** React Flow nodes array + connection edges array (DAG JSON map).
 * **Execution:** Topological sort over nodes to determine pipeline dependencies (e.g., Data Source \rightarrow Preprocessing \rightarrow Train \rightarrow Evaluate).
 * **Output:** Standard Python .py script string compiling boilerplate code using the individual pytorch_template attributes mapped inside plugin manifests.
## 3. Step-by-Step Execution Plan for Agent
Follow this sequence precisely to build out the MVP codebase.
### Phase 1: Foundation Setup (Static Scaffold)
 * [ ] Initialize React + Tailwind CSS + React Flow environment.
 * [ ] Establish global LanguageContext supporting en | zh | parallel.
 * [ ] Build the "Three-Samwich" Layout: Left Drawer (Playbook Guide Container), Center Panel (React Flow Canvas Area), Right Drawer (Interactive Component Parameter Controls).
 * [ ] Add a top header navbar containing a 3-way radio toggle switch (English | 中文 | Parallel 并行).
### Phase 2: Core Data Flow Engine
 * [ ] Create the Dynamic Plugin Loader infrastructure parsing dummy manifest folders.
 * [ ] Wire up React Flow handles based on dynamic input/output settings defined inside manifest.json.
 * [ ] Implement reactive parameter state updating: when a user drags a slider handle, update the local execution context instantly.
### Phase 3: Visual & Educational Polish
 * [ ] Configure Framer Motion spring animation behaviors natively over React Flow nodes and panels during mounting/toggling phases.
 * [ ] Implement localization bindings onto node titles, control labels, and step-by-step description workflows. Verify that switching to parallel displays combined tokens elegantly.
### Phase 4: Downstream Export Utility
 * [ ] Build the linear configuration code translator handling active workflow state string interpolation parsing.
 * [ ] Include a prominent action button: [ 🛠️ Export PyTorch Code / 编译为 PyTorch 代码 ] that generates a file download directly within the client browser.
## 4. Acceptance Criteria & Prompt Check
To verify your completion of this prompt instruction, guarantee the following:
 1. Turning on Parallel Mode prints out 梯度下降 (Gradient Descent) style mixed formats on components.
 2. Dropping a fresh folder into src/plugins/ declaring parameters instantly manifests a brand new operable block element on screen without touching routing structures.
 3. No external server endpoints (axios/fetch dependencies targeting machine learning computations) are declared; computing runs entirely via frontend loops.
