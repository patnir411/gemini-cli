/**
 * DAG Viewer - Renders hierarchical execution flow
 * Shows: Turns → Agents → Subagents → Tools
 */

class DAGViewer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.svg = null;
        this.dagData = null;
        this.nodeWidth = 140;
        this.nodeHeight = 50;
        this.nodeSpacing = 30;
        this.levelSpacing = 180;

        this.initSVG();
    }

    initSVG() {
        this.container.innerHTML = '<svg id="dag-svg" width="100%" height="600" style="background:#f9fafb;border-radius:8px;"></svg>';
        this.svg = document.getElementById('dag-svg');
    }

    update(dagGraph) {
        console.log('[DAG] Update called with:', dagGraph);

        if (!dagGraph) {
            console.log('[DAG] No dagGraph provided');
            this.renderEmpty();
            return;
        }

        if (!dagGraph.nodes || dagGraph.nodes.length === 0) {
            console.log('[DAG] No nodes in graph');
            this.renderEmpty();
            return;
        }

        console.log('[DAG] Rendering', dagGraph.nodes.length, 'nodes');
        this.dagData = dagGraph;
        this.render();
    }

    renderEmpty() {
        if (!this.svg) return;
        this.svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="14">No execution data yet - start a conversation in Gemini CLI</text>';
    }

    render() {
        if (!this.svg || !this.dagData) return;

        const nodes = this.dagData.nodes;
        const edges = this.dagData.edges;

        // Calculate layout
        const layout = this.calculateLayout(nodes);

        // Clear SVG
        this.svg.innerHTML = '';

        // Create defs for markers
        this.svg.innerHTML += `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                    <polygon points="0 0, 10 3, 0 6" fill="#667eea"/>
                </marker>
                <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
        `;

        // Draw edges first (so they're behind nodes)
        edges.forEach(edge => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);

            if (fromNode && toNode && layout[fromNode.id] && layout[toNode.id]) {
                const from = layout[fromNode.id];
                const to = layout[toNode.id];

                // Draw connection line
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = `M ${from.x + this.nodeWidth} ${from.y + this.nodeHeight/2} L ${to.x} ${to.y + this.nodeHeight/2}`;
                line.setAttribute('d', d);
                line.setAttribute('stroke', edge.type === 'subagent' ? '#8b5cf6' : '#667eea');
                line.setAttribute('stroke-width', edge.type === 'subagent' ? '3' : '2');
                line.setAttribute('stroke-dasharray', edge.type === 'parallel' ? '5,5' : '0');
                line.setAttribute('marker-end', 'url(#arrowhead)');
                line.setAttribute('fill', 'none');
                this.svg.appendChild(line);
            }
        });

        // Draw nodes
        nodes.forEach(node => {
            const pos = layout[node.id];
            if (!pos) return;

            this.drawNode(node, pos.x, pos.y);
        });
    }

    drawNode(node, x, y) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${x}, ${y})`);

        // Color by type
        const colors = {
            'turn': { fill: '#dbeafe', stroke: '#3b82f6' },
            'agent': { fill: '#f3e8ff', stroke: '#8b5cf6' },
            'tool': { fill: '#d1fae5', stroke: '#10b981' },
            'response': { fill: '#f3f4f6', stroke: '#6b7280' }
        };

        // Status colors
        const statusColors = {
            'running': '#3b82f6',
            'success': '#10b981',
            'error': '#ef4444',
            'pending': '#f59e0b',
            'cancelled': '#6b7280'
        };

        const color = colors[node.type] || colors.tool;
        const statusColor = statusColors[node.status] || '#667eea';

        // Node rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', this.nodeWidth);
        rect.setAttribute('height', this.nodeHeight);
        rect.setAttribute('rx', '8');
        rect.setAttribute('fill', color.fill);
        rect.setAttribute('stroke', node.status === 'running' ? statusColor : color.stroke);
        rect.setAttribute('stroke-width', node.status === 'running' ? '3' : '2');

        if (node.status === 'running') {
            rect.setAttribute('filter', 'url(#glow)');
        }

        g.appendChild(rect);

        // Node label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', this.nodeWidth / 2);
        text.setAttribute('y', this.nodeHeight / 2 - 5);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '13');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', '#374151');
        text.textContent = node.label.length > 18 ? node.label.substring(0, 16) + '...' : node.label;
        g.appendChild(text);

        // Status/duration
        if (node.metadata.duration) {
            const duration = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            duration.setAttribute('x', this.nodeWidth / 2);
            duration.setAttribute('y', this.nodeHeight / 2 + 12);
            duration.setAttribute('text-anchor', 'middle');
            duration.setAttribute('font-size', '10');
            duration.setAttribute('fill', '#6b7280');
            duration.textContent = node.metadata.duration + 'ms';
            g.appendChild(duration);
        } else if (node.status === 'running') {
            const status = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            status.setAttribute('x', this.nodeWidth / 2);
            status.setAttribute('y', this.nodeHeight / 2 + 12);
            status.setAttribute('text-anchor', 'middle');
            status.setAttribute('font-size', '10');
            status.setAttribute('fill', statusColor);
            status.textContent = '● Running';
            g.appendChild(status);
        }

        // Click handler for details
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => this.showNodeDetails(node));

        this.svg.appendChild(g);
    }

    calculateLayout(nodes) {
        const layout = {};
        let currentY = 20;

        // Group nodes by turn (parent)
        const nodesByTurn = new Map();

        nodes.forEach(node => {
            if (node.type === 'turn') {
                nodesByTurn.set(node.id, [node]);
            } else if (node.parentId) {
                // Find ultimate turn parent
                let parent = node.parentId;
                while (parent) {
                    const parentNode = nodes.find(n => n.id === parent);
                    if (!parentNode) break;
                    if (parentNode.type === 'turn') {
                        if (!nodesByTurn.has(parent)) {
                            nodesByTurn.set(parent, []);
                        }
                        nodesByTurn.get(parent).push(node);
                        break;
                    }
                    parent = parentNode.parentId;
                }
            }
        });

        // Layout each turn's nodes
        nodesByTurn.forEach((turnNodes, turnId) => {
            const turnNode = turnNodes.find(n => n.id === turnId);
            if (!turnNode) return;

            // Turn at left
            layout[turnId] = { x: 20, y: currentY };

            // Children to the right, stacked vertically
            const children = turnNodes.filter(n => n.id !== turnId);
            children.forEach((child, index) => {
                const indent = child.type === 'agent' ? this.levelSpacing : this.levelSpacing * 2;
                layout[child.id] = {
                    x: 20 + indent,
                    y: currentY + (index * (this.nodeHeight + this.nodeSpacing))
                };
            });

            // Move down for next turn
            currentY += Math.max(children.length, 1) * (this.nodeHeight + this.nodeSpacing) + 40;
        });

        return layout;
    }

    showNodeDetails(node) {
        const details = document.getElementById('dag-details');
        if (!details) return;

        details.innerHTML = `
            <div style="padding:15px;background:white;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="color:#667eea;margin-bottom:10px;">${node.label}</h3>
                <div style="font-size:0.9em;color:#6b7280;">
                    <div><strong>Type:</strong> ${node.type}</div>
                    <div><strong>Status:</strong> ${node.status}</div>
                    ${node.metadata.duration ? `<div><strong>Duration:</strong> ${node.metadata.duration}ms</div>` : ''}
                    ${node.metadata.model ? `<div><strong>Model:</strong> ${node.metadata.model}</div>` : ''}
                    ${node.metadata.tokens ? `<div><strong>Tokens:</strong> ${node.metadata.tokens}</div>` : ''}
                </div>
                ${node.metadata.args ? `
                    <div style="margin-top:10px;">
                        <strong>Arguments:</strong>
                        <pre style="background:#f9fafb;padding:8px;border-radius:4px;font-size:0.8em;margin-top:5px;max-height:150px;overflow-y:auto;">${JSON.stringify(node.metadata.args, null, 2)}</pre>
                    </div>
                ` : ''}
                ${node.metadata.result ? `
                    <div style="margin-top:10px;">
                        <strong>Result:</strong>
                        <pre style="background:#f9fafb;padding:8px;border-radius:4px;font-size:0.8em;margin-top:5px;max-height:150px;overflow-y:auto;">${JSON.stringify(node.metadata.result, null, 2).substring(0, 500)}...</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }
}

// Global instance
let dagViewer = null;

function initDAGViewer() {
    dagViewer = new DAGViewer('dag-container');
}

function updateDAG(dagGraph) {
    if (dagViewer) {
        dagViewer.update(dagGraph);
    }
}
