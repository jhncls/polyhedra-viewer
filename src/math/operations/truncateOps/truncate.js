// @flow strict
import _ from 'lodash';

import { flatMap, repeat, find } from 'utils';
import { withOrigin, PRECISION } from 'math/linAlg';
import { Polyhedron } from 'math/polyhedra';

function getFamily(polyhedron) {
  const faceTypes = polyhedron.faceTypes();
  if (_.includes(faceTypes, 5)) return 'I';
  if (_.includes(faceTypes, 4)) return 'O';
  return 'T';
}

function getReference(type) {
  switch (type) {
    case 'O':
      return 'truncated cuboctahedron';
    case 'I':
      return 'truncated icosidodecahedron';
    default:
      throw new Error('Unidentified polyhedron');
  }
}

// Side ratios gotten when calling our "sharpen" operation on a bevelled polyhedron
// I couldn't actually figure out the math for this so I reverse engineered it.
function getRectifiedMultiplier(type) {
  switch (type) {
    case 'O':
      return 0.37966751081253297;
    case 'I':
      return 0.4059223426569837;
    default:
      throw new Error('Unidentified polyhedron');
  }
}

function duplicateVertices(polyhedron) {
  const mapping = {};
  const count = polyhedron.getVertex().adjacentFaces().length;
  _.forEach(polyhedron.vertices, v => {
    _.forEach(v.adjacentFaces(), (face, i) => {
      _.set(mapping, [face.index, v.index], i);
    });
  });

  return polyhedron.withChanges(solid => {
    return solid
      .withVertices(flatMap(polyhedron.vertices, v => repeat(v.value, count)))
      .mapFaces(face => {
        return _.flatMap(face.vertices, v => {
          const base = count * v.index;
          const j = mapping[face.index][v.index];
          return [base + ((j + 1) % count), base + j];
        });
      })
      .addFaces(
        _.map(polyhedron.vertices, v =>
          _.range(v.index * count, (v.index + 1) * count),
        ),
      );
  });
}

function getTruncateLength(polyhedron) {
  const face = polyhedron.smallestFace();
  const n = face.numSides;
  const theta = Math.PI / n;
  const newTheta = theta / 2;
  return 2 * face.apothem() * Math.tan(newTheta);
}

function getTruncateTransform(polyhedron, duplicated) {
  if (polyhedron.isRegular()) {
    return (vector, vertex) => vector;
  }

  // If we're doing a bevel, we need to do some fidgeting to make sure the created
  // faces are all regular
  const family = getFamily(polyhedron);
  const truncateLength = getTruncateLength(polyhedron);
  const oldSideLength = polyhedron.edgeLength();

  const multiplier = getRectifiedMultiplier(family);
  const newSideLength = oldSideLength * multiplier;
  const faceResizeScale = newSideLength / truncateLength;

  const reference = Polyhedron.get(getReference(family));
  const normalizedResizeAmount =
    reference.faceWithNumSides(6).distanceToCenter() / reference.edgeLength() -
    polyhedron.smallestFace().distanceToCenter() / newSideLength;

  return (vector, vertex) => {
    const smallFace = find(vertex.adjacentFaces(), {
      numSides: 6,
    });
    const normal = smallFace.withPolyhedron(polyhedron).normal();
    const transform = withOrigin(smallFace.centroid(), v =>
      v
        .scale(faceResizeScale)
        .add(normal.scale(normalizedResizeAmount * newSideLength)),
    );
    return transform(vector);
  };
}

function doTruncate(polyhedron, rectify = false) {
  const truncateLength = getTruncateLength(polyhedron);
  const oldSideLength = polyhedron.edgeLength();
  const truncateScale = (oldSideLength - truncateLength) / 2 / oldSideLength;
  const duplicated = duplicateVertices(polyhedron);
  const transform = getTruncateTransform(polyhedron, duplicated);

  const truncatedVertices = duplicated.vertices.map(vertex => {
    const adjacentVertices = vertex.adjacentVertices();
    const v = vertex.vec;
    const v1 = find(adjacentVertices, adj => adj.vec.distanceTo(v) > PRECISION);
    const truncated = v.interpolateTo(v1.vec, rectify ? 0.5 : truncateScale);
    return !!transform ? transform(truncated, vertex) : truncated;
  });
  return {
    animationData: {
      start: duplicated,
      endVertices: truncatedVertices,
    },
  };
}

export function truncate(polyhedron: Polyhedron) {
  return doTruncate(polyhedron);
}

export function rectify(polyhedron: Polyhedron) {
  return doTruncate(polyhedron, true);
}
