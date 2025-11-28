import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  MarkerType,
  Position,
  Handle,
} from "reactflow";
import "reactflow/dist/style.css";
// Removed @dagrejs/dagre to avoid dynamic require of @dagrejs/graphlib in sandboxed env
// We'll use a small built-in layered layout (cycle-tolerant) instead.

// ==========================
// Static Data (no backend)
// Replace SAMPLE_COURSES with your university catalog at build time.
// Course object supports either simple AND prereqs or grouped rules:
// {
//   id, name, description,
//   prereqs?: string[]                 // ALL of these
//   prereqGroups?: [{                  // Additional groups
//     type: "ANY" | "ALL" | "KOF",
//     k?: number,                      // only for KOF
//     courseIds: string[]              // members of the group
//   }]
// }
// ==========================
const SAMPLE_COURSES = [
  {
    id: "CSE3",
    name: "CSE 3 — Computing Technology in a Changing Society",
    description: "Intro to computer hardware, software, networking, and societal impact. Includes hands-on experience with web pages, games, 3D printing, VR tools, and cybersecurity.",
    prereqs: []
  },
  {
    id: "CSE5J",
    name: "CSE 5J — Introduction to Programming in Java",
    description: "Introductory programming and problem-solving in Java. Covers algorithms, documentation, compilers, and editors. Prepares for CSE 11 or CSE 12 sequence.",
    prereqs: []
  },
  {
    id: "CSE10",
    name: "CSE 10 — Introduction to Computer Science",
    description: "Overview of theory, foundations, and practice of CS. Covers algorithms, hardware, programming languages, and limitations of computation. No programming required.",
    prereqs: []
  },
  {
    id: "CSE12",
    name: "CSE 12 — Computer Systems and Assembly Language and Lab",
    description: "Intro to computer systems and assembly. Covers digital logic, compiling, assembly, system software, and computer architecture. 7 credits with lab.",
    prereqs: ["CSE5J", "CSE20", "CSE30", "BME160"]
  },
  {
    id: "CSE13S",
    name: "CSE 13S — Computer Systems and C Programming",
    description: "Focus on C programming, command line, shell, editors, debuggers, and source code control. Includes process model, memory, and data representation.",
    prereqs: ["CSE12", "BME160"]
  },
  {
    id: "CSE16",
    name: "CSE 16 — Applied Discrete Mathematics",
    description: "Sets, functions, relations, graphs, proof techniques, permutations, recurrences. Applications drawn from CS/CE. Programming knowledge recommended.",
    prereqs: ["MATH19A","MATH20A","MATH19B","MATH20B","MATH11B","AM11B","AM15B","ECON11B"]
  },
  {
    id: "CSE20",
    name: "CSE 20 — Beginning Programming in Python",
    description: "Intro to Python programming. Topics include data types, control flow, methods, OOP basics. No prior programming experience required.",
    prereqs: []
  },
  {
    id: "CSE30",
    name: "CSE 30 — Programming Abstractions: Python",
    description: "Intermediate Python programming, software development, OOP abstractions, and structured software design.",
    prereqs: ["CSE20","BME160","MATH3","MATH11A","MATH19A","MATH20A","AM3","AM11A","ECON11A"]
  },
  {
    id: "CSE40",
    name: "CSE 40 — Machine Learning Basics: Data Analysis and Empirical Methods",
    description: "Intro to math and programming abstractions for ML and data science. Includes probability, linear algebra, optimization, and visualization.",
    prereqs: ["MATH19B","MATH20B","CSE30"]
  },
  {
    id: "CSE80A",
    name: "CSE 80A — Universal Access: Disability, Technology, and Society",
    description: "Human-centered technology for accessibility. Covers legislation, universal design, and psychosocial aspects of disability.",
    prereqs: []
  },
  {
    id: "CSE80L",
    name: "CSE 80L — Social Data Analytics and Visualization",
    description: "Covers social data analytics, bias, visualization, and applications in environment, economics, and education.",
    prereqs: []
  },
  {
    id: "CSE80N",
    name: "CSE 80N — Introduction to Networking and the Internet",
    description: "Intro to Internet evolution, routing algorithms, reliability, peer-to-peer systems, security, compression, and digital media.",
    prereqs: []
  },
  {
    id: "CSE80S",
    name: "CSE 80S — Social Networks",
    description: "Covers structure of networks, WWW, information flow, and game theory. Includes principles of search engines and ad placement.",
    prereqs: ["MATH3","MATH11A","AM3","AM6","AM11A","AM15A","AM11B","ECON11A"]
  },
  {
    id: "CSE100",
    name: "CSE 100 — Logic Design",
    description: "Boolean algebra, minimization, sequential circuits, logic devices, and intro to system design.",
    prereqs: ["CSE12"],
    prereqGroups: [{ type: "ALL", courseIds: ["CSE100L"] }]
  },
  {
    id: "CSE100L",
    name: "CSE 100L — Logic Design Lab",
    description: "Hands-on logic design with oscilloscopes, CAD tools, and programmable logic.",
    prereqs: ["CSE12"],
    prereqGroups: [{ type: "ALL", courseIds: ["CSE100"] }]
  },
  {
    id: "CSE101",
    name: "CSE 101 — Introduction to Data Structures and Algorithms",
    description: "Abstract data types, algorithms, big-O, linked lists, stacks, queues, trees, graphs. Implemented in C/C++.",
    prereqs: ["CSE12","BME160","CSE13E","ECE13","CSE13S","CSE16","CSE30","MATH11B","MATH19B","MATH20B","AM11B","ECON11B"]
  },
  {
    id: "CSE101M",
    name: "CSE 101M — Mathematical Thinking for Computer Science",
    description: "Problem-solving and proof techniques for CS, including modeling and LaTeX proofs.",
    prereqs: ["CSE101","CSE101P"]
  },
  {
    id: "CSE101P",
    name: "CSE 101P — Data Structures and Algorithms in Python",
    description: "Data structures and algorithms with Python. Focus on ADTs, big-O, and graph algorithms.",
    prereqs: ["CSE16","BME160","CSE20","CSE30","MATH11B","MATH19B","MATH20B","AM11B"]
  },
  {
    id: "CSE102",
    name: "CSE 102 — Introduction to Analysis of Algorithms",
    description: "Algorithm design and mathematical analysis. Covers divide-and-conquer, dynamic programming, lower bounds, and recurrence relations.",
    prereqs: ["CSE101M"]
  },
  {
    id: "CSE103",
    name: "CSE 103 — Computational Models",
    description: "Covers finite automata, grammars, parsing, pumping lemmas, Turing machines, and complexity theory.",
    prereqs: ["CSE101M"]
  },
  {
    id: "CSE104",
    name: "CSE 104 — Computability and Computational Complexity",
    description: "Covers Turing machines, grammars, computability, diagonalization, Halting problem, NP-completeness, and reductions.",
    prereqs: ["CSE103"]
  },
  {
    id: "CSE105",
    name: "CSE 105 — Modern Algorithmic Toolbox",
    description: "Focus on algorithmic ideas and techniques in modern data science. Covers discrete math, probability, graph theory, and optimization.",
    prereqs: ["CSE101M","CSE102"]
  },
  {
    id: "CSE106",
    name: "CSE 106 — Applied Graph Theory and Algorithms",
    description: "Graph algorithms for connectivity, routing, matching, and embedding. Applications in computer engineering.",
    prereqs: ["CSE101"]
  },
  {
    id: "CSE107",
    name: "CSE 107 — Probability and Statistics for Engineers",
    description: "Probability, statistics, Markov chains, and stochastic processes. Applications to design and measurement.",
    prereqs: ["CSE16","AM30","MATH22","MATH23A"]
  },
];


// Layout + visuals
const NODE_W = 260;
const NODE_H = 140;
const GATE_W = 64;
const GATE_H = 28;

// Utility: id for gate nodes
const gateId = (courseId, idx) => `GATE_${courseId}_${idx}`;

// ----- graph helpers -----
function buildIndex(courses) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const children = new Map(); // courseId -> [downstream courseIds]

  const addChild = (from, to) => {
    if (!children.has(from)) children.set(from, []);
    children.get(from).push(to);
  };

  for (const c of courses) {
    for (const p of c.prereqs || []) addChild(p, c.id);
    for (const g of c.prereqGroups || []) {
      for (const src of g.courseIds || []) addChild(src, c.id); // logical edge for ancestry/descendency
    }
  }
  return { byId, children };
}

function computeAncestors(byId, startId) {
  const anc = new Set();
  (function dfs(id) {
    const c = byId.get(id);
    if (!c) return;
    // direct AND prereqs
    for (const p of c.prereqs || []) {
      if (!anc.has(p)) { anc.add(p); dfs(p); }
    }
    // groups (treat all members as possible parents)
    for (const g of c.prereqGroups || []) {
      for (const p of g.courseIds || []) {
        if (!anc.has(p)) { anc.add(p); dfs(p); }
      }
    }
  })(startId);
  return anc;
}

function computeDependents(children, startId) {
  const dep = new Set();
  (function dfs(id) {
    for (const k of children.get(id) || []) {
      if (!dep.has(k)) { dep.add(k); dfs(k); }
    }
  })(startId);
  return dep;
}

// Build React Flow nodes & edges (including requirement gate nodes)
function buildGraph(courses, children, showIds) {
  const nodes = [];
  const edges = [];

  // course nodes first
  for (const c of courses) {
    nodes.push({
      id: c.id,
      type: "course",
      position: { x: 0, y: 0 },
      data: {
        course: c,
        showIds,
        bg: "#ffffff",
        prereqCount: (c.prereqs?.length || 0) + (c.prereqGroups?.reduce((a, g) => a + (g.courseIds?.length || 0), 0) || 0),
        dependentCount: (children.get(c.id) || []).length,
      },
      style: { width: NODE_W, height: NODE_H },
      zIndex: 2,
      selectable: true,
    });
  }

  // edges for simple prereqs
  for (const c of courses) {
    for (const p of c.prereqs || []) {
      edges.push({
        id: `e-${p}-${c.id}`,
        source: p,
        target: c.id,
        type: "bezier",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 2, stroke: "#cbd5e1", opacity: 0.9 },
      });
    }
  }

  // groups → gate nodes & edges
  for (const c of courses) {
    (c.prereqGroups || []).forEach((g, i) => {
      const gid = gateId(c.id, i);
      // gate node
      nodes.push({
        id: gid,
        type: "gate",
        position: { x: 0, y: 0 },
        data: {
          label: g.type === "ALL" ? "ALL" : g.type === "KOF" ? `≥${g.k} of ${g.courseIds?.length || 0}` : "OR",
          tooltip: g.type === "KOF" ? `At least ${g.k} of ${g.courseIds?.length || 0}` : (g.type === "ALL" ? "All of" : "Any 1 of"),
        },
        style: { width: GATE_W, height: GATE_H },
        zIndex: 0,
        draggable: true,
        selectable: false,
      });
      // member → gate edges
      for (const src of g.courseIds || []) {
        edges.push({
          id: `e-${src}-${gid}`,
          source: src,
          target: gid,
          type: "bezier",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { strokeWidth: 2, stroke: "#cbd5e1", opacity: 0.9 },
        });
      }
      // gate → course edge
      edges.push({
        id: `e-${gid}-${c.id}`,
        source: gid,
        target: c.id,
        type: "bezier",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 2, stroke: "#cbd5e1", opacity: 0.9 },
      });
    });
  }

  return { nodes, edges };
}

// ---- Simple, cycle-tolerant layered layout (no Dagre) ----
// - Builds ranks using Kahn's algorithm; if a cycle exists, breaks it by
//   picking a node with the smallest in-degree.
// - Places columns left-to-right, rows top-to-bottom.
const LAYOUT = {
  rankSep: 180,
  nodeSep: 36,
  marginX: 40,
  marginY: 40,
};

function layoutWithDagre(nodes, edges, direction = "LR") { // keep old name for wiring
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const succ = new Map();
  const pred = new Map();
  const inDeg = new Map();

  for (const n of nodes) {
    succ.set(n.id, new Set());
    pred.set(n.id, new Set());
    inDeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!succ.has(e.source) || !pred.has(e.target)) continue;
    if (!succ.get(e.source).has(e.target)) {
      succ.get(e.source).add(e.target);
      pred.get(e.target).add(e.source);
      inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
    }
  }

  // Kahn with cycle breaking
  const order = [];
  const queue = [];
  for (const [id, d] of inDeg.entries()) if (d === 0) queue.push(id);
  const remaining = new Set(nodes.map((n) => n.id));

  while (order.length < nodes.length) {
    if (queue.length === 0) {
      // break a cycle: pick the node with smallest in-degree among remaining
      let pick = null;
      let min = Infinity;
      for (const id of remaining) {
        const d = inDeg.get(id) ?? 0;
        if (d < min) { min = d; pick = id; }
      }
      if (pick == null) break; // should not happen
      queue.push(pick);
    }
    const u = queue.shift();
    if (!remaining.has(u)) continue;
    order.push(u);
    remaining.delete(u);
    for (const v of succ.get(u) || []) {
      const d = (inDeg.get(v) || 0) - 1;
      inDeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  // Assign ranks
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (const u of order) {
    for (const v of succ.get(u) || []) {
      const next = (rank.get(u) || 0) + 1;
      if ((rank.get(v) || 0) < next) rank.set(v, next);
    }
  }

  // Group by rank
  const byRank = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id) || 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(n.id);
  }

  // Sort inside each rank for visual stability (courses before gates, then id)
  for (const [r, arr] of byRank.entries()) {
    arr.sort((a, b) => {
      const na = idToNode.get(a);
      const nb = idToNode.get(b);
      if (na.type !== nb.type) return na.type === "course" ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  // Compute positions
  const laidOut = nodes.map((n) => ({ ...n }));
  const index = new Map(laidOut.map((n) => [n.id, n]));

  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  let x = LAYOUT.marginX;
  for (const r of ranks) {
    const ids = byRank.get(r);
    let y = LAYOUT.marginY;
    for (const id of ids) {
      const n = index.get(id);
      const w = n.type === "gate" ? GATE_W : (n.style?.width || NODE_W);
      const h = n.type === "gate" ? GATE_H : (n.style?.height || NODE_H);
      n.position = { x, y };
      y += h + LAYOUT.nodeSep + (n.type === "gate" ? 6 : 0);
    }
    x += NODE_W + LAYOUT.rankSep; // column advance by course-width baseline
  }

  return laidOut;
}

// ----- custom nodes -----
function CourseNode({ data /*, selected*/ }) {
  const { showIds, course, prereqCount, dependentCount } = data;
  const title = showIds ? `${course.id} — ${course.name}` : course.name;
  return (
    <div className="relative rounded-2xl border border-slate-300 shadow-sm p-3 overflow-hidden" style={{ width: NODE_W, height: NODE_H, pointerEvents: "auto", backgroundColor: (data?.bg ?? "#ffffff") }}>
      <div className="text-[13px] font-semibold text-slate-900 truncate" title={title}>
        {title.length > 42 ? title.slice(0, 39) + "…" : title}
      </div>
      <div className="my-2 h-px bg-slate-200" />
      <div className="text-[12px] leading-5 text-slate-700" style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {course.description}
      </div>
      <div className="absolute bottom-2 left-2 flex gap-2">
        <div className="px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700">Prereqs: {prereqCount}</div>
        <div className="px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700">Dependents: {dependentCount}</div>
      </div>
      {/* connection handles (not connectable by users in this demo) */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

function GateNode({ data }) {
  return (
    <div className="relative grid place-items-center rounded-full bg-slate-200 text-slate-700 text-[11px] shadow-sm" style={{ width: GATE_W, height: GATE_H, pointerEvents: "auto" }} title={data?.tooltip}>
      {data?.label ?? "OR"}
      {/* invisible handles so edges can anchor to the gate */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

const nodeTypes = { course: CourseNode, gate: GateNode };

export default function PrereqVisualizerReactFlow() {
  const [courses] = useState(SAMPLE_COURSES);
  const { byId, children } = useMemo(() => buildIndex(courses), [courses]);

  const [showIds, setShowIds] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  // initial nodes/edges
  const initialGraph = useMemo(() => buildGraph(courses, children, showIds), [courses, children]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // one-time layout
  useEffect(() => {
    const laidOut = layoutWithDagre(initialGraph.nodes, initialGraph.edges, "LR");
    setNodes(laidOut);
    setEdges(initialGraph.edges);
  }, [initialGraph, setNodes, setEdges]);

  // search filtering & showIds update (keep selected node's prereqs & dependents visible)
  useEffect(() => {
    const q = query.trim().toLowerCase();

    const baseVisible = new Set(
      courses
        .filter((c) => !q || `${c.id} ${c.name} ${c.description}`.toLowerCase().includes(q))
        .map((c) => c.id)
    );

    // Force-include selected + its ancestors & dependents
    const forcedCourses = new Set();
    if (selected) {
      forcedCourses.add(selected);
      computeAncestors(byId, selected).forEach((id) => forcedCourses.add(id));
      computeDependents(children, selected).forEach((id) => forcedCourses.add(id));
    }

    // Start with course visibility
    const courseVisible = new Set([...baseVisible, ...forcedCourses]);

    // Add gate visibility if target AND at least one input are visible
    const gateVisible = new Set();
    for (const c of courses) {
      (c.prereqGroups || []).forEach((g, i) => {
        const gid = gateId(c.id, i);
        const anyInputVisible = (g.courseIds || []).some((cid) => courseVisible.has(cid));
        const showGate = courseVisible.has(c.id) && anyInputVisible;
        if (showGate) gateVisible.add(gid);
      });
    }

    const nodeVisible = new Set([...courseVisible, ...gateVisible]);

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        hidden: !nodeVisible.has(n.id),
        data: n.type === "course" ? { ...n.data, showIds } : n.data,
      }))
    );

    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        hidden: !(nodeVisible.has(e.source) && nodeVisible.has(e.target)),
      }))
    );
  }, [query, showIds, selected, courses, byId, children, setNodes, setEdges]);

  // highlight ancestors/descendants (set background via node data; gates unchanged)
  useEffect(() => {
    const anc = selected ? computeAncestors(byId, selected) : new Set();
    const dep = selected ? computeDependents(children, selected) : new Set();

    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "course") return n; // leave gates as-is
        let bg = "#ffffff";
        if (selected && n.id === selected) bg = "#eef2ff"; // selected
        else if (selected && anc.has(n.id)) bg = "#ecfeff"; // prereqs
        else if (selected && dep.has(n.id)) bg = "#fef9c3"; // dependents
        return { ...n, data: { ...n.data, bg } };
      })
    );
  }, [selected, byId, children, setNodes]);

  const onConnect = useCallback(() => {
    // disabled in this static demo (no editing graph)
    return null;
  }, []);

  const onNodeClick = useCallback((_, node) => {
    if (node.type === "gate") return; // ignore gate clicks for selection
    setSelected((s) => (s === node.id ? null : node.id));
  }, []);

  const autoLayout = useCallback(() => {
    setNodes((nds) => layoutWithDagre(nds, edges, "LR"));
  }, [edges, setNodes]);

  const fitViewRef = React.useRef(null);
  const onInit = useCallback((instance) => {
    fitViewRef.current = instance;
    setTimeout(() => instance.fitView({ padding: 0.12 }), 0);
  }, []);

  const fit = useCallback(() => {
    fitViewRef.current?.fitView({ padding: 0.12 });
  }, []);

  // ---- Runtime smoke tests (non-blocking) ----
  useEffect(() => {
    // simple 3-node chain A->B->C layout sanity
    const testNodes = [
      { id: "A", type: "course", style: { width: NODE_W, height: NODE_H } },
      { id: "B", type: "course", style: { width: NODE_W, height: NODE_H } },
      { id: "C", type: "course", style: { width: NODE_W, height: NODE_H } },
    ];
    const testEdges = [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
    ];
    const out = layoutWithDagre(testNodes, testEdges);
    const byId = new Map(out.map((n) => [n.id, n]));
    try {
      console.assert(byId.get("A").position.x < byId.get("B").position.x, "A should be left of B");
      console.assert(byId.get("B").position.x < byId.get("C").position.x, "B should be left of C");
    } catch (err) {
      console.warn("Layout smoke test failed:", err);
    }
  }, []);

  return (
    <div className="w-screen h-screen bg-slate-50 text-slate-800">
      {/* Toolbar */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-white/85 backdrop-blur border border-slate-200 rounded-2xl shadow px-3 py-2">
        <div className="font-semibold tracking-tight text-slate-700 pr-2">Prereq Visualizer (React Flow)</div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search courses… (code, name, description)"
          className="px-3 py-1.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-80"
        />
        <button onClick={fit} className="text-sm px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-100">Fit</button>
        <button onClick={autoLayout} className="text-sm px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-100">Auto Layout</button>
        <label className="text-xs flex items-center gap-1 pl-2 cursor-pointer select-none">
          <input type="checkbox" checked={showIds} onChange={(e) => setShowIds(e.target.checked)} />
          Show IDs
        </label>
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 text-xs text-slate-600 bg-white/75 backdrop-blur border border-slate-200 rounded-xl px-3 py-1 shadow">
        Wheel to zoom · Drag to pan · Drag nodes to reposition · Click a course to highlight prereqs & dependents
      </div>

      {/* Canvas */}
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          edgesSelectable={false}
          edgesFocusable={false}
          fitView
          onInit={onInit}
          nodeTypes={nodeTypes}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap pannable zoomable />
          <Controls position="bottom-right" />
          <Background variant="dots" gap={18} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}
