import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const SUGGESTION_DEBOUNCE_MS = 250;

function normalizeCourses(rawCourses = []) {
  return rawCourses.map((course) => {
    const simplePrereqs = new Set();
    const groupedPrereqs = [];

    (course.prereqGroups || []).forEach((group) => {
      if (!Array.isArray(group)) return;
      const ids = [...new Set(group.filter(Boolean))];
      if (ids.length === 0) return;
      if (ids.length === 1) {
        simplePrereqs.add(ids[0]);
      } else {
        groupedPrereqs.push({
          type: "ANY",
          courseIds: ids,
        });
      }
    });

    return {
      ...course,
      prereqs: [...simplePrereqs],
      prereqGroups: groupedPrereqs,
    };
  });
}

// Layout + visuals
const NODE_W = 320;
const NODE_H = 180;
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
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 2, stroke: "#cbd5e1", opacity: 0.9 },
      });
    }
  }

  // groups → gate nodes & edges
  for (const c of courses) {
    (c.prereqGroups || []).forEach((g, i) => {
      const gid = gateId(c.id, i);
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
      for (const src of g.courseIds || []) {
        edges.push({
          id: `e-${src}-${gid}`,
          source: src,
          target: gid,
          type: "default",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { strokeWidth: 2, stroke: "#cbd5e1", opacity: 0.9 },
        });
      }
      edges.push({
        id: `e-${gid}-${c.id}`,
        source: gid,
        target: c.id,
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 2, stroke: "#cbd5e1", opacity: 0.9 },
      });
    });
  }

  return { nodes, edges };
}

// ---- Simple, cycle-tolerant layered layout (no Dagre) ----
const LAYOUT = {
  rankSep: 180,
  nodeSep: 36,
  marginX: 40,
  marginY: 40,
};

function layoutWithDagre(nodes, edges) {
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

  const order = [];
  const queue = [];
  for (const [id, d] of inDeg.entries()) if (d === 0) queue.push(id);
  const remaining = new Set(nodes.map((n) => n.id));

  while (order.length < nodes.length) {
    if (queue.length === 0) {
      let pick = null;
      let min = Infinity;
      for (const id of remaining) {
        const d = inDeg.get(id) ?? 0;
        if (d < min) { min = d; pick = id; }
      }
      if (pick == null) break;
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

  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (const u of order) {
    for (const v of succ.get(u) || []) {
      const next = (rank.get(u) || 0) + 1;
      if ((rank.get(v) || 0) < next) rank.set(v, next);
    }
  }

  const byRank = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id) || 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(n.id);
  }

  for (const arr of byRank.values()) {
    arr.sort((a, b) => {
      const na = idToNode.get(a);
      const nb = idToNode.get(b);
      if (na.type !== nb.type) return na.type === "course" ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  const laidOut = nodes.map((n) => ({ ...n }));
  const index = new Map(laidOut.map((n) => [n.id, n]));

  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  let x = LAYOUT.marginX;
  for (const r of ranks) {
    const ids = byRank.get(r);
    let y = LAYOUT.marginY;
    for (const id of ids) {
      const n = index.get(id);
      const h = n.type === "gate" ? GATE_H : (n.style?.height || NODE_H);
      n.position = { x, y };
      y += h + LAYOUT.nodeSep + (n.type === "gate" ? 6 : 0);
    }
    x += NODE_W + LAYOUT.rankSep;
  }

  return laidOut;
}

function CourseNode({ data }) {
  const { showIds, course, prereqCount, dependentCount } = data;
  const title = showIds ? `${course.id} — ${course.name}` : course.name;
  return (
    <div
      className="relative rounded-2xl border border-slate-300 shadow-sm p-3 overflow-hidden"
      style={{ width: NODE_W, height: NODE_H, pointerEvents: "auto", backgroundColor: data?.bg ?? "#ffffff" }}
    >
      <div className="text-[13px] font-semibold text-slate-900 truncate" title={title}>
        {title.length > 42 ? title.slice(0, 39) + "…" : title}
      </div>
      <div className="my-2 h-px bg-slate-200" />
      <div
        className="text-[12px] leading-5 text-slate-700"
        style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {course.description}
      </div>
      <div className="absolute bottom-2 left-2 flex gap-2">
        <div className="px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700">Prereqs: {prereqCount}</div>
        <div className="px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700">Dependents: {dependentCount}</div>
      </div>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

function GateNode({ data }) {
  return (
    <div className="relative grid place-items-center rounded-full bg-slate-200 text-slate-700 text-[11px] shadow-sm" style={{ width: GATE_W, height: GATE_H, pointerEvents: "auto" }} title={data?.tooltip}>
      {data?.label ?? "OR"}
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

const nodeTypes = { course: CourseNode, gate: GateNode };

export default function PrereqVisualizerReactFlow() {
  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [courseDetail, setCourseDetail] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isUserTyping, setIsUserTyping] = useState(false);
  const [pendingExternalFetch, setPendingExternalFetch] = useState(null);
  const { byId, children } = useMemo(() => buildIndex(courses), [courses]);

  const [showIds] = useState(false);
  const [selected, setSelected] = useState(null);
  const [hideInstructions, setHideInstructions] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState(null);

  const initialGraph = useMemo(
    () => buildGraph(courses, children, showIds),
    [courses, children, showIds]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadDepartments() {
      setLoadingDepartments(true);
      try {
        const response = await fetch(`${API_BASE_URL}/courses`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to load departments (${response.status})`);
        const data = await response.json();
        setDepartments(data);
        setFetchError(null);
        setSelectedSlug((prev) => prev || data[0]?.slug || "");
      } catch (error) {
        if (controller.signal.aborted) return;
        setFetchError(error.message || "Unable to load departments.");
      } finally {
        if (!controller.signal.aborted) setLoadingDepartments(false);
      }
    }
    loadDepartments();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setCourseDetail(null);
    setCourses([]);
    setSelected(null);
    setFetchError(null);
  }, [selectedSlug]);

  useEffect(() => {
    if (!selectedSlug || courseQuery.trim().length < 2 || !isUserTyping) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      setShowSuggestions(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const response = await fetch(
          `${API_BASE_URL}/courses/${selectedSlug}/search?q=${encodeURIComponent(courseQuery)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Failed to search courses (${response.status})`);
        const data = await response.json();
        setSuggestions(data);
        setShowSuggestions(Boolean(data.length));
      } catch (error) {
        if (!controller.signal.aborted) console.warn(error);
      } finally {
        if (!controller.signal.aborted) setLoadingSuggestions(false);
      }
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [selectedSlug, courseQuery, isUserTyping]);

  const fetchCourseDetail = useCallback(
    async (courseId, slugOverride) => {
      const slugToUse = slugOverride || selectedSlug;
      if (!slugToUse || !courseId) return;
      const trimmed = courseId.trim();
      if (!trimmed) return;
      setLoadingDetail(true);
      setShowSuggestions(false);
      setIsUserTyping(false);
      setFetchError(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}/courses/${slugToUse}/classes/${encodeURIComponent(trimmed)}`
        );
        if (!response.ok) throw new Error(`Failed to load course (${response.status})`);
        const data = await response.json();
        setCourseDetail(data);
        const relatedCourses = data.related_courses?.length
          ? data.related_courses
          : [data.course];
        const externalReferences = data.external_prereqs || [];
        // External courses are added as nodes (with empty prereqGroups since we don't
        // traverse their prereqs). The related_courses already have the correct
        // prereqGroups with external course IDs included, so we just need to add
        // the external course nodes themselves.
        const externalCourses = externalReferences.map((ref) => ({
          ...ref.course,
          prereqGroups: [],
          sourceSlug: ref.slug,
          sourceDepartment: ref.department,
        }));
        setCourses(normalizeCourses([...relatedCourses, ...externalCourses]));
        setSuggestions([]);
        setPendingFocusId(data.course?.id || trimmed);
      } catch (error) {
        setCourseDetail(null);
        setCourses([]);
        setFetchError(error.message || "Unable to load course detail.");
        setPendingFocusId(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedSlug]
  );

  const onSearchSubmit = useCallback(
    (event) => {
      event.preventDefault();
      fetchCourseDetail(courseQuery);
    },
    [courseQuery, fetchCourseDetail]
  );

  useEffect(() => {
    setSelected(courseDetail?.course?.id ?? null);
    setDetailCollapsed(false);
  }, [courseDetail?.course?.id]);

  useEffect(() => {
    const laidOut = layoutWithDagre(initialGraph.nodes, initialGraph.edges);
    setNodes(laidOut);
    setEdges(initialGraph.edges);
  }, [initialGraph, setNodes, setEdges]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.type === "course"
          ? {
              ...n,
              data: { ...n.data, showIds },
            }
          : n
      )
    );
  }, [showIds, setNodes]);

  useEffect(() => {
    const anc = selected ? computeAncestors(byId, selected) : new Set();
    const dep = selected ? computeDependents(children, selected) : new Set();

    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "course") return n;
        let bg = "#ffffff";
        if (selected && n.id === selected) bg = "#eef2ff";
        else if (selected && anc.has(n.id)) bg = "#ecfeff";
        else if (selected && dep.has(n.id)) bg = "#fef9c3";
        return { ...n, data: { ...n.data, bg } };
      })
    );
  }, [selected, byId, children, setNodes]);

  const onConnect = useCallback(() => null, []);

  const onNodeClick = useCallback(
    (_, node) => {
      if (node.type === "gate") return;
      const nodeCourse = node.data?.course;
      const targetSlug = nodeCourse?.sourceSlug || selectedSlug;
      setSelected(node.id);
      setCourseQuery(node.id);
      setShowSuggestions(false);
      if (nodeCourse?.sourceSlug && nodeCourse.sourceSlug !== selectedSlug) {
        setSelectedSlug(nodeCourse.sourceSlug);
        setPendingExternalFetch({ slug: nodeCourse.sourceSlug, courseId: node.id });
      } else {
        fetchCourseDetail(node.id, targetSlug);
      }
    },
    [fetchCourseDetail, selectedSlug]
  );

  const fitViewRef = useRef(null);
  const onInit = useCallback((instance) => {
    fitViewRef.current = instance;
    setTimeout(() => instance.fitView({ padding: 0.12 }), 0);
  }, []);
  // Increment a counter each time the graph finishes layout so we can trigger centering
  const [layoutVersion, setLayoutVersion] = useState(0);
  useEffect(() => {
    // After nodes are set from layout, bump version
    setLayoutVersion((v) => v + 1);
  }, [nodes]);

  useEffect(() => {
    if (!pendingFocusId || !fitViewRef.current) return;
    const instance = fitViewRef.current;

    // Find the target node in the current nodes state (which has fresh positions)
    const target = nodes.find((n) => n.id === pendingFocusId);
    if (!target) {
      // Node not in graph yet, wait for next layout
      return;
    }

    // Use a timeout to allow React Flow to render the new positions
    const timeoutId = setTimeout(() => {
      instance.fitView({
        nodes: [{ id: pendingFocusId }],
        padding: 0.25,
        duration: 400,
      });
      setPendingFocusId(null);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [pendingFocusId, layoutVersion, nodes]);

  useEffect(() => {
    if (!pendingExternalFetch) return;
    if (pendingExternalFetch.slug === selectedSlug) {
      fetchCourseDetail(pendingExternalFetch.courseId, pendingExternalFetch.slug);
      setPendingExternalFetch(null);
    }
  }, [pendingExternalFetch, selectedSlug, fetchCourseDetail]);

  useEffect(() => {
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
    const byIdNodes = new Map(out.map((n) => [n.id, n]));
    try {
      console.assert(byIdNodes.get("A").position.x < byIdNodes.get("B").position.x, "A should be left of B");
      console.assert(byIdNodes.get("B").position.x < byIdNodes.get("C").position.x, "B should be left of C");
    } catch (err) {
      console.warn("Layout smoke test failed:", err);
    }
  }, []);

  const handleSuggestionSelect = useCallback(
    (courseId) => {
      setCourseQuery(courseId);
      setShowSuggestions(false);
      fetchCourseDetail(courseId);
    },
    [fetchCourseDetail]
  );

  return (
    <div className="w-screen h-screen bg-slate-50 text-slate-800">
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-2 bg-white/85 backdrop-blur border border-slate-200 rounded-2xl shadow px-4 py-2">
        <div className="font-semibold tracking-tight text-slate-700 pr-2">prereqs</div>
        <label className="text-xs flex items-center gap-1">
          <select
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            className="px-2 py-1.5 rounded-xl border border-slate-300 text-sm bg-white min-w-[220px]"
            disabled={loadingDepartments}
          >
            {!selectedSlug && <option value="">Select…</option>}
            {departments.map((dept) => (
              <option key={dept.slug} value={dept.slug}>
                {dept.department}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={onSearchSubmit} className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              type="text"
              value={courseQuery}
              onChange={(e) => {
                setCourseQuery(e.target.value);
                setIsUserTyping(true);
              }}
              placeholder="Search course ID or title"
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-80"
              disabled={!selectedSlug || loadingDepartments}
              onFocus={() => setShowSuggestions(Boolean(suggestions.length) && isUserTyping)}
              onBlur={() => setShowSuggestions(false)}
            />
            {loadingSuggestions && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">…</div>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg z-50">
                {suggestions.map((course) => (
                  <button
                    type="button"
                    key={course.id}
                    className="w-full text-left px-3 py-2 hover:bg-slate-100"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      handleSuggestionSelect(course.id);
                      setShowSuggestions(false);
                    }}
                  >
                    <div className="text-sm font-semibold text-slate-800">{course.id}</div>
                    <div className="text-xs text-slate-500">{course.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            className="text-sm px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-100"
            disabled={!selectedSlug || !courseQuery.trim() || loadingDetail}
          >
            Search
          </button>
        </form>
        <div className="text-[11px] text-slate-500 whitespace-nowrap">
          {loadingDepartments ? "Loading departments…" : ""}
        </div>
        {fetchError && (
          <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
            {fetchError}
          </div>
        )}
      </div>

      {courseDetail && (
        <div className="fixed top-28 right-6 z-40 w-96 bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-lg px-4 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{courseDetail.department}</div>
            <div className="text-sm font-semibold text-slate-800 mt-0.5">
              {courseDetail.course.name}
            </div>
            </div>
            <button
              type="button"
              onClick={() => setDetailCollapsed((prev) => !prev)}
              className="text-xs text-slate-500 hover:text-slate-700 transition"
            >
              {detailCollapsed ? "Expand" : "Minimize"}
            </button>
          </div>
          {!detailCollapsed && (
            <>
              <div>
                <div className="text-[12px] text-slate-600 mt-2 leading-5 max-h-24 overflow-y-auto pr-1">
                  {courseDetail.course.description}
                </div>
                {courseDetail.course.credits && (
                  <div className="text-[11px] text-slate-500 mt-1">Credits: {courseDetail.course.credits}</div>
                )}
                {!!courseDetail.missing_prereq_ids?.length && (
                  <div className="text-[11px] text-slate-500 mt-1">Unresolved prereqs: {courseDetail.missing_prereq_ids.join(", ")}</div>
                )}
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Prerequisites</div>
                {courseDetail.prerequisites.length ? (
                  <ul className="mt-1 text-[12px] text-slate-700 space-y-1 max-h-24 overflow-y-auto pr-1 list-disc list-inside">
                {courseDetail.prerequisites.map((course) => (
                  <li key={`pre-${course.id}`}>
                    {course.name}
                  </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12px] text-slate-500 mt-1">No in-department prerequisites</div>
                )}
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Postrequisites</div>
                {courseDetail.postrequisites.length ? (
                  <ul className="mt-1 text-[12px] text-slate-700 space-y-1 max-h-24 overflow-y-auto pr-1 list-disc list-inside">
                {courseDetail.postrequisites.map((course) => (
                  <li key={`post-${course.id}`}>
                    {course.name}
                  </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12px] text-slate-500 mt-1">No downstream courses in catalog</div>
                )}
              </div>
              {!!courseDetail.external_prereqs?.length && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 uppercase">External Prerequisites</div>
                  <ul className="mt-1 text-[12px] text-slate-700 space-y-1 max-h-24 overflow-y-auto pr-1 list-disc list-inside">
                    {courseDetail.external_prereqs.map((entry) => (
                      <li key={`ext-${entry.course.id}`}>
                        {entry.course.name}
                        <span className="text-[11px] text-slate-500"> ({entry.department})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!hideInstructions && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 text-xs text-slate-600 bg-white/85 backdrop-blur border border-slate-200 rounded-xl px-3 py-1 shadow flex items-center gap-2">
          <span>Choose a department, search a class, then explore its prereqs & dependents. Wheel to zoom · Drag to pan · Click nodes to highlight relationships.</span>
          <button
            type="button"
            onClick={() => setHideInstructions(true)}
            className="text-slate-400 hover:text-slate-600 transition"
            aria-label="Dismiss instructions"
          >
            ×
          </button>
        </div>
      )}

      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          // edgesSelectable={false}
          // edgesFocusable={false}
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
        {(loadingDepartments || loadingDetail) && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="px-4 py-2 rounded-xl bg-white/85 border border-slate-200 text-sm text-slate-600 shadow">
              {loadingDepartments ? "Loading departments…" : "Loading course…"}
            </div>
          </div>
        )}
        {!loadingDetail && selectedSlug && !courses.length && !fetchError && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="px-4 py-2 rounded-xl bg-white/90 border border-slate-200 text-sm text-slate-600 shadow">
              Search for a class to visualize its prereqs & postrecs.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
