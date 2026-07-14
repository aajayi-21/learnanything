// Graph-editor staging model. Every user gesture on the concept map (create /
// flip / retype / retire an edge, or a syllabus reorder) becomes a `PendingEdit`
// held in local state; "file edits" compiles the whole batch to the one write
// path (`api.proposeGraphEdits`). Nothing here mutates the vault — it only shapes
// the payloads and derives the topological order / cycle checks the UI needs.

import type {
  ConceptGraphEdge,
  ConceptGraphNode,
  GraphEditInput,
  PreviewKnowledgeMapInput
} from "../../api/dto";

export type Relation = "prerequisite" | "confusable_with" | "related" | "part_of";

// Ordered for the picker (prerequisite first — it's the only ordering relation).
export const RELATIONS: Relation[] = ["prerequisite", "related", "part_of", "confusable_with"];

// Layer-honesty caption shown on every edge-editing surface (design principle 3).
export const HONESTY_CAPTION =
  "prerequisite edges order the curriculum and shape the map; they never change readiness — recipes govern readiness.";

// A staged edit. `op` mirrors the graph-editor operation vocabulary
// (create/update/delete); `kind` on updates records the gesture for ghost
// rendering. For update/delete, source/target/relationType hold the *resulting*
// edge (post-gesture); `edgeId` is the live edge the item targets.
export type PendingEdit =
  | { pid: string; op: "create"; source: string; target: string; relationType: Relation }
  | {
      pid: string;
      op: "update";
      edgeId: string;
      source: string;
      target: string;
      relationType: Relation;
      kind: "flip" | "retype" | "reorder";
    }
  | { pid: string; op: "delete"; edgeId: string; source: string; target: string; relationType: Relation };

let pidCounter = 0;
export function newPid(): string {
  pidCounter += 1;
  return `pe_${Date.now().toString(36)}_${pidCounter.toString(36)}`;
}

// Compile the staged batch to `proposeGraphEdits` items. Payload carries the
// on-disk snake_case field names (`relation_type`); the sidecar accepts the
// `source`/`target` keys and maps them to the authoring payload model. A retire
// still sends source/target/relation_type (the sidecar snapshots the live edge
// regardless, but sending them keeps the item self-describing).
export function compileEdits(pending: PendingEdit[]): GraphEditInput[] {
  return pending.map((p) => {
    if (p.op === "create") {
      return {
        itemType: "concept_edge",
        operation: "create",
        payload: { source: p.source, target: p.target, relation_type: p.relationType },
        targetEntityId: null
      };
    }
    if (p.op === "update") {
      return {
        itemType: "concept_edge",
        operation: "update",
        payload: { source: p.source, target: p.target, relation_type: p.relationType },
        targetEntityId: p.edgeId
      };
    }
    return {
      itemType: "concept_edge",
      operation: "delete",
      payload: { source: p.source, target: p.target, relation_type: p.relationType },
      targetEntityId: p.edgeId
    };
  });
}

// Split pending edits into the maps the renderer needs: which committed edges are
// updated / deleted, and the free-standing creates.
export interface ResolvedPending {
  updatedById: Map<string, Extract<PendingEdit, { op: "update" }>>;
  deletedById: Map<string, Extract<PendingEdit, { op: "delete" }>>;
  creates: Extract<PendingEdit, { op: "create" }>[];
}

export function resolvePending(pending: PendingEdit[]): ResolvedPending {
  const updatedById = new Map<string, Extract<PendingEdit, { op: "update" }>>();
  const deletedById = new Map<string, Extract<PendingEdit, { op: "delete" }>>();
  const creates: Extract<PendingEdit, { op: "create" }>[] = [];
  for (const p of pending) {
    if (p.op === "create") creates.push(p);
    else if (p.op === "update") updatedById.set(p.edgeId, p);
    else deletedById.set(p.edgeId, p);
  }
  return { updatedById, deletedById, creates };
}

// The geometry-preview payload: creates add an edge; updates remove the live edge
// and add its rewritten form; deletes just remove.
export function previewInput(pending: PendingEdit[]): PreviewKnowledgeMapInput {
  const addedEdges: PreviewKnowledgeMapInput["addedEdges"] = [];
  const removedEdgeIds: string[] = [];
  for (const p of pending) {
    if (p.op === "create") {
      addedEdges.push({ source: p.source, target: p.target, relationType: p.relationType });
    } else if (p.op === "update") {
      removedEdgeIds.push(p.edgeId);
      addedEdges.push({ source: p.source, target: p.target, relationType: p.relationType });
    } else {
      removedEdgeIds.push(p.edgeId);
    }
  }
  return { addedEdges, removedEdgeIds };
}

export interface OrderEdge {
  source: string;
  target: string;
}

// Prerequisite edges after applying the pending batch — the ordering relation
// that drives layout depth, the syllabus order, and cycle checks.
export function effectivePrereqEdges(edges: ConceptGraphEdge[], pending: PendingEdit[]): OrderEdge[] {
  const { updatedById, deletedById, creates } = resolvePending(pending);
  const out: OrderEdge[] = [];
  for (const e of edges) {
    if (deletedById.has(e.id)) continue;
    const up = updatedById.get(e.id);
    if (up) {
      if (up.relationType === "prerequisite") out.push({ source: up.source, target: up.target });
      continue;
    }
    if (e.relationType === "prerequisite") out.push({ source: e.source, target: e.target });
  }
  for (const c of creates) {
    if (c.relationType === "prerequisite") out.push({ source: c.source, target: c.target });
  }
  return out;
}

// Longest-path depth over prerequisite edges, mirroring layoutConcepts: a node's
// depth is 1 + max depth of its prerequisites. Returns concept ids ordered by
// (depth asc, title asc) — the derived syllabus order.
export function topoOrder(concepts: ConceptGraphNode[], prereq: OrderEdge[]): string[] {
  const depth: Record<string, number> = {};
  concepts.forEach((c) => {
    depth[c.id] = 0;
  });
  const valid = prereq.filter((e) => e.source in depth && e.target in depth);
  for (let iter = 0; iter < concepts.length; iter += 1) {
    let changed = false;
    for (const e of valid) {
      if (depth[e.target] < depth[e.source] + 1) {
        depth[e.target] = depth[e.source] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const title = new Map(concepts.map((c) => [c.id, c.title || c.id] as const));
  return concepts
    .map((c) => c.id)
    .sort((a, b) => {
      const da = depth[a] ?? 0;
      const db = depth[b] ?? 0;
      if (da !== db) return da - db;
      return (title.get(a) ?? a).localeCompare(title.get(b) ?? b);
    });
}

// Cycle detection over a prerequisite edge set (DFS with a recursion stack).
export function hasCycle(prereq: OrderEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of prereq) {
    const bucket = adj.get(e.source) ?? [];
    bucket.push(e.target);
    adj.set(e.source, bucket);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on-stack, 2 done
  const visit = (node: string): boolean => {
    state.set(node, 1);
    for (const next of adj.get(node) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) return true;
      if (s === 0 && visit(next)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0 && visit(node)) return true;
  }
  return false;
}

// Infer the minimal prerequisite edits that realize a syllabus drag: moving
// `movedId` from `fromIndex` to `toIndex` in the derived order. For each concept
// it crosses, flip a contradicting committed prerequisite edge, or add a new one
// where no ordering edge exists. Refuse (return `error`) if the result cycles.
export function inferReorderEdits(params: {
  movedId: string;
  fromIndex: number;
  toIndex: number;
  ordered: string[];
  edges: ConceptGraphEdge[];
  pending: PendingEdit[];
}): { edits: PendingEdit[]; error?: string } {
  const { movedId, fromIndex, toIndex, ordered, edges, pending } = params;
  if (fromIndex === toIndex) return { edits: [] };

  const { updatedById, deletedById } = resolvePending(pending);
  // Live committed prerequisite edges keyed by "source->target", excluding those
  // already retired/rewritten by the pending batch.
  const committedPrereq = new Map<string, ConceptGraphEdge>();
  for (const e of edges) {
    if (e.relationType !== "prerequisite") continue;
    if (deletedById.has(e.id) || updatedById.has(e.id)) continue;
    committedPrereq.set(`${e.source}->${e.target}`, e);
  }
  // Effective ordering pairs after the current batch (either direction) so we can
  // recognise an already-satisfied relationship and skip it.
  const effective = effectivePrereqEdges(edges, pending);
  const effectiveSet = new Set(effective.map((e) => `${e.source}->${e.target}`));

  const movingEarlier = toIndex < fromIndex;
  const crossed = movingEarlier
    ? ordered.slice(toIndex, fromIndex)
    : ordered.slice(fromIndex + 1, toIndex + 1);

  const edits: PendingEdit[] = [];
  const staged = new Set<string>(); // dedupe by edgeId or pair

  for (const other of crossed) {
    if (other === movedId) continue;
    // Desired direction after the drag: moving earlier ⇒ moved precedes other
    // (moved->other); moving later ⇒ other precedes moved (other->moved).
    const wantSource = movingEarlier ? movedId : other;
    const wantTarget = movingEarlier ? other : movedId;
    const wantKey = `${wantSource}->${wantTarget}`;
    const oppositeKey = `${wantTarget}->${wantSource}`;

    if (effectiveSet.has(wantKey)) continue; // already ordered the way we want

    const contradicting = committedPrereq.get(oppositeKey);
    if (contradicting) {
      if (staged.has(contradicting.id)) continue;
      staged.add(contradicting.id);
      edits.push({
        pid: newPid(),
        op: "update",
        edgeId: contradicting.id,
        source: wantSource,
        target: wantTarget,
        relationType: "prerequisite",
        kind: "reorder"
      });
      continue;
    }
    // No committed edge either way (a pending-only opposite is left alone to keep
    // the inference transparent) → add a fresh prerequisite edge.
    if (staged.has(wantKey)) continue;
    staged.add(wantKey);
    edits.push({ pid: newPid(), op: "create", source: wantSource, target: wantTarget, relationType: "prerequisite" });
  }

  if (edits.length === 0) return { edits: [] };

  // Refuse drags that would cycle against committed + existing pending + new edits.
  const resulting = effectivePrereqEdges(edges, [...pending, ...edits]);
  if (hasCycle(resulting)) {
    return { edits: [], error: "That move would create a prerequisite cycle." };
  }
  return { edits };
}
