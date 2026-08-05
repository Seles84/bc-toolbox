/**
 * Builds and lays out the owner/lover relationship graph around a focal
 * member, walking the local members database (plus placeholder nodes for
 * people referenced in relationships but never captured).
 *
 * Layout: ownership forms a forest (everyone has at most one owner), drawn as
 * tidy trees with owners above their submissives; lover edges are drawn as
 * dashed curves between whatever positions the tree layout produced.
 */
import { db } from '@/shared/db';

export const NODE_W = 156;
export const NODE_H = 46;
const H_GAP = 28;
const LEVEL_H = 120;
const TREE_GAP = 64;
const MAX_NODES = 400;

interface SlimMember {
    id: number;
    label: string;
    color?: string;
    known: boolean;
    ownerId?: number;
    ownerStage: number;
    ownerName?: string;
    lovers: { id?: number; name?: string; stage: number }[];
}

export interface GraphNode {
    id: number;
    label: string;
    color?: string;
    /** Captured in the database (false = placeholder from relationship info) */
    known: boolean;
    x: number;
    y: number;
}

export interface GraphEdge {
    from: number;
    to: number;
    type: 'owns' | 'loves';
    stage: number;
}

export interface RelationshipGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    width: number;
    height: number;
    truncated: boolean;
}

export async function buildRelationshipGraph(focal: number, maxDepth: number): Promise<RelationshipGraph> {
    // Slim in-memory view of every captured member (drop images etc.).
    const byId = new Map<number, SlimMember>();
    const subsByOwner = new Map<number, number[]>();
    await db.members.each((m) => {
        byId.set(m.memberNumber, {
            id: m.memberNumber,
            label: m.nickname || m.name || `#${m.memberNumber}`,
            color: m.labelColor,
            known: true,
            ownerId: m.ownership?.MemberNumber,
            ownerStage: m.ownership?.Stage ?? 0,
            ownerName: m.ownership?.Name,
            lovers: (m.lovership ?? [])
                .filter((l) => l.MemberNumber || l.Name)
                .map((l) => ({ id: l.MemberNumber, name: l.Name, stage: l.Stage ?? 0 })),
        });
    });

    // Placeholder ids for lovers known only by name (negative, stable per name).
    let placeholderSeq = -1;
    const placeholderByName = new Map<string, number>();
    const placeholders = new Map<number, { label: string }>();
    function placeholderId(name: string): number {
        let id = placeholderByName.get(name);
        if (id === undefined) {
            id = placeholderSeq--;
            placeholderByName.set(name, id);
            placeholders.set(id, { label: name });
        }
        return id;
    }

    // BFS out from the focal member.
    const included = new Set<number>();
    const edges = new Map<string, GraphEdge>();
    let truncated = false;
    let frontier = [focal];
    included.add(focal);

    function addEdge(type: 'owns' | 'loves', from: number, to: number, stage: number) {
        const key = type === 'loves' ? `loves:${Math.min(from, to)}:${Math.max(from, to)}` : `owns:${from}:${to}`;
        if (!edges.has(key)) {
            edges.set(key, { from, to, type, stage });
        }
    }

    function include(id: number, next: number[]) {
        if (included.size >= MAX_NODES) {
            truncated = true;
            return;
        }
        if (!included.has(id)) {
            included.add(id);
            next.push(id);
        }
    }

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
        const next: number[] = [];
        for (const id of frontier) {
            const member = byId.get(id);

            // Owner (walk upward) — may be someone we never captured.
            if (member?.ownerId) {
                addEdge('owns', member.ownerId, id, member.ownerStage);
                include(member.ownerId, next);
            }

            // Submissives (walk downward).
            for (const subId of subsByOwner.get(id) ?? []) {
                addEdge('owns', id, subId, byId.get(subId)?.ownerStage ?? 0);
                include(subId, next);
            }

            // Lovers (sideways).
            for (const lover of member?.lovers ?? []) {
                const loverId = lover.id ?? placeholderId(lover.name ?? '?');
                if (lover.id === undefined && lover.name === undefined) continue;
                addEdge('loves', id, loverId, lover.stage);
                include(loverId, next);
            }
        }
        frontier = next;
    }

    // Materialize nodes.
    const nodes = new Map<number, GraphNode>();
    for (const id of included) {
        const member = byId.get(id);
        if (member) {
            nodes.set(id, { id, label: member.label, color: member.color, known: true, x: 0, y: 0 });
        } else if (placeholders.has(id)) {
            nodes.set(id, { id, label: placeholders.get(id)!.label, known: false, x: 0, y: 0 });
        } else {
            // Referenced by number but never captured — try to find a name
            // from whoever they own.
            const name =
                [...byId.values()].find((m) => m.ownerId === id)?.ownerName ?? `#${id}`;
            nodes.set(id, { id, label: name, known: false, x: 0, y: 0 });
        }
    }

    // Drop owns-edges whose endpoints didn't make it in (node cap).
    const edgeList = [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to));

    layout(nodes, edgeList);

    let width = 0;
    let height = 0;
    for (const node of nodes.values()) {
        width = Math.max(width, node.x + NODE_W);
        height = Math.max(height, node.y + NODE_H);
    }

    return { nodes: [...nodes.values()], edges: edgeList, width, height, truncated };
}

/** Tidy-tree layout over the ownership forest; lover-only nodes are roots. */
function layout(nodes: Map<number, GraphNode>, edges: GraphEdge[]): void {
    const children = new Map<number, number[]>();
    const hasParent = new Set<number>();
    for (const edge of edges) {
        if (edge.type !== 'owns') continue;
        if (!children.has(edge.from)) children.set(edge.from, []);
        children.get(edge.from)!.push(edge.to);
        hasParent.add(edge.to);
    }

    const roots = [...nodes.keys()].filter((id) => !hasParent.has(id));
    const visited = new Set<number>();

    /** Returns subtree width; positions the subtree with its left edge at x. */
    function place(id: number, x: number, depth: number): number {
        if (visited.has(id)) return 0; // defensive: malformed ownership cycles
        visited.add(id);

        const node = nodes.get(id)!;
        node.y = depth * LEVEL_H;

        const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
        if (kids.length === 0) {
            node.x = x;
            return NODE_W;
        }

        let childX = x;
        let total = 0;
        for (const kid of kids) {
            const w = place(kid, childX, depth + 1);
            if (w > 0) {
                childX += w + H_GAP;
                total += w + H_GAP;
            }
        }
        total = Math.max(total - H_GAP, NODE_W);

        // Center the parent over its children's span.
        const firstKid = nodes.get(kids[0]!)!;
        const lastPlaced = kids.filter((k) => visited.has(k));
        const lastKid = nodes.get(lastPlaced[lastPlaced.length - 1]!)!;
        node.x = (firstKid.x + lastKid.x) / 2;
        return total;
    }

    let cursor = 0;
    for (const root of roots) {
        if (visited.has(root)) continue;
        const width = place(root, cursor, 0);
        if (width > 0) {
            cursor += width + TREE_GAP;
        }
    }
}
