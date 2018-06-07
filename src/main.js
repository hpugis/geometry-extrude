import earcut from 'earcut';
import {slerp, scale, normalize, lineIntersection} from './math';

export function triangulate(vertices, holes, dimensions=2) {
    return earcut(vertices, holes, dimensions);
};

export function flatten(data) {
    return earcut.flatten(data);
}

function offsetPolygon(vertices, out, start, end, offset) {
    for (let i = start, j = end - 1, k = end - 2; i < end; i++) {
        const x1 = vertices[k * 2];
        const y1 = vertices[k * 2 + 1];
        const x2 = vertices[j * 2];
        const y2 = vertices[j * 2 + 1];
        const x3 = vertices[i * 2];
        const y3 = vertices[i * 2 + 1];

        let dx1 = y2 - y1;
        let dy1 = x1 - x2;

        let dx2 = y3 - y2;
        let dy2 = x2 - x3;

        const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) / offset;
        const l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) / offset;

        dx1 /= l1;
        dy1 /= l1;
        dx2 /= l2;
        dy2 /= l2;

        lineIntersection(
            x1 + dx1, y1 + dy1, x2 + dx1, y2 + dy1,
            x2 + dx2, y2 + dy2, x3 + dx2, y3 + dy2,
            out, j * 2
        );

        k = j;
        j = i;
    }
}

export function offsetPolygonWithHole(vertices, holes, offset) {
    const offsetVertices = new Float32Array(vertices.length);
    const exteriorSize = (holes && holes.length) ? holes[0] : vertices.length / 2;

    offsetPolygon(vertices, offsetVertices, 0, exteriorSize, offset);

    if (holes) {
        for (let i = 0; i < holes.length; i++) {
            const start = holes[i];
            const end = i === holes.length - 1 ? vertices.length : holes[i + 1];
            offsetPolygon(vertices, offsetVertices, start, end, offset);
        }
    }

    return offsetVertices;
}


// 0,0----1,0
// 0,1----1,1
const quadToTriangle = [
    [0, 0], [1, 0], [1, 1],
    [0, 0], [1, 1], [0, 1]
];

// TODO Hole, smooth bevel, UV, separate top
// TODO If smooth connection between side and bevel.
function extrudePolygon({indices, vertices, holes, vertexOffset, indexOffset}, opts, out) {
    const depth = opts.depth;
    if (vertices.length <= 2) {
        return;
    }
    const bevelSize = Math.min(!(opts.bevelSegments > 0) ? 0 : opts.bevelSize, opts.depth / 2);
    const bevelSegments = opts.bevelSegments;

    let topVertices = vertices;
    if (bevelSize > 0) {
        topVertices = offsetPolygonWithHole(vertices, holes, opts.bevelSize);
    }

    let vOff = vertexOffset * 3;
    let iOff = indexOffset;
    // Top vertices
    for (let i = 0; i < topVertices.length; i += 2) {
        out.position[vOff++] = topVertices[i];
        out.position[vOff++] = topVertices[i + 1];
        out.position[vOff++] = depth;
    }
    // Top indices
    const indicesLen = indices.length;
    for (let i = 0; i < indicesLen; i++) {
        out.indices[iOff++] = vertexOffset * 3 + indices[i];
    }

    const ringVertexCount = vertices.length / 2;
    const splitSide = opts.smoothSide ? 1 : 2;
    const splitRingVertexCount = ringVertexCount * splitSide;

    const splitBevel = opts.smoothBevel ? 1 : 2;
    // Side vertices
    if (bevelSize > 0) {

        const v0 = [0, 0, 1];
        const v1 = [];
        const v2 = [0, 0, -1];
        const v = [];

        let ringCount = 0;
        for (let k = 0; k < 2; k++) {
            const z = (k === 0 ? (depth - bevelSize) : bevelSize);
            for (let s = 0; s <= bevelSegments * splitBevel; s++) {
                for (let i = 0; i < ringVertexCount; i++) {

                    for (let j = 0; j < splitSide; j++) {
                        let idx = ((i + j) % ringVertexCount) * 2;
                        v1[0] = vertices[idx] - topVertices[idx];
                        v1[1] = vertices[idx + 1] - topVertices[idx + 1];
                        v1[2] = 0;
                        normalize(v1, v1);

                        const t = (Math.floor(s / splitBevel) + (s % splitBevel)) / bevelSegments;
                        k === 0 ? slerp(v, v0, v1, t)
                            : slerp(v, v1, v2, t);

                        out.position[vOff++] = v[0] * bevelSize + topVertices[idx];
                        out.position[vOff++] = v[1] * bevelSize + topVertices[idx + 1];
                        out.position[vOff++] = v[2] * bevelSize + z;
                    }

                    if ((splitBevel > 1 && (s % splitBevel)) || (splitBevel === 1 && s >= 1)) {
                        for (var f = 0; f < 6; f++) {
                            const m = (quadToTriangle[f][0] + i * splitSide) % splitRingVertexCount;
                            const n = quadToTriangle[f][1] + ringCount;
                            out.indices[iOff++] = (n - 1) * splitRingVertexCount + ringVertexCount
                                 + m + vertexOffset;
                        }
                    }
                }

                ringCount++;
            }
        }
    }
    else {
        for (let k = 0; k < 2; k++) {
            const z = k === 0 ? depth - bevelSize : bevelSize;
            for (let i = 0; i < ringVertexCount; i++) {
                for (let m = 0; m < splitSide; m++) {
                    const idx = ((i + m) % ringVertexCount) * 2;
                    out.position[vOff++] = vertices[idx];
                    out.position[vOff++] = vertices[idx + 1];
                    out.position[vOff++] = z;
                }
            }
        }
    }
    // Connect the side
    const sideStartRingN = bevelSize > 0 ? (bevelSegments * splitBevel + 1) : 1;
    for (let i = 0; i < ringVertexCount; i++) {
        for (var f = 0; f < 6; f++) {
            const m = (quadToTriangle[f][0] + i * splitSide) % splitRingVertexCount;
            const n = quadToTriangle[f][1] + sideStartRingN;
            out.indices[iOff++] = (n - 1) * splitRingVertexCount + ringVertexCount + m + vertexOffset;
        }
    }

    // Bottom indices
    for (let i = 0; i < indicesLen; i += 3) {
        for (let k = 0; k < 3; k++) {
            out.indices[iOff++] = vOff / 3 + indices[i + 2 - k];
        }
    }
    // Bottom vertices
    for (let i = 0; i < topVertices.length; i += 2) {
        out.position[vOff++] = topVertices[i];
        out.position[vOff++] = topVertices[i + 1];
        out.position[vOff++] = 0;
    }
}

/**
 *
 * @param {Array} polygons Polygons array that match GeoJSON MultiPolygon geometry.
 * @param {Object} [opts]
 * @param {number} [opts.height]
 * @param {number} [opts.bevelSize = 0]
 * @param {number} [opts.bevelSegments = 2]
 * @param {boolean} [opts.smoothSide = false]
 * @param {boolean} [opts.smoothBevel = false]
 */
export function extrude(polygons, opts) {

    opts = opts || {};
    opts.depth = opts.depth || 1;
    opts.bevelSize = opts.bevelSize || 0;
    opts.bevelSegments = opts.bevelSegments == null ? 2 : opts.bevelSegments;
    opts.smoothSide = opts.smoothSide || false;
    opts.smoothBevel = opts.smoothBevel || false;

    const hasBevel = opts.bevelSize > 0 && opts.bevelSegments > 0;

    const preparedData = [];
    let indexCount = 0;
    let vertexCount = 0;
    for (let p = 0; p < polygons.length; p++) {
        const polygon = polygons[p];
        const {vertices, holes, dimensions} = earcut.flatten(polygon);
        const indices = triangulate(vertices, holes, dimensions);
        const polygonVertexCount = vertices.length / 2;
        preparedData.push({
            indices,
            vertices,
            holes,
            indexOffset: indexCount,
            vertexOffset: vertexCount
        });
        const ringCount = 2 + (hasBevel ? opts.bevelSegments * 2 : 0);
        indexCount += indices.length * 2
            + polygonVertexCount * 6 * (ringCount - 1);

        const sideRingVertexCount = polygonVertexCount * (opts.smoothSide ? 1 : 2);
        vertexCount += polygonVertexCount * 2
            + sideRingVertexCount * (
                // Double the bevel vertex number if not smooth
                ringCount + ((!opts.smoothBevel && hasBevel) ? opts.bevelSegments * sideRingVertexCount * 2 : 0)
            );
    }

    const data = {
        position: new Float32Array(vertexCount * 3),
        indices: new (vertexCount > 0xffff ? Uint32Array : Uint16Array)(indexCount)
    };
    for (let d = 0; d < preparedData.length; d++) {
        extrudePolygon(preparedData[d], opts, data);
    }

    return data;
};