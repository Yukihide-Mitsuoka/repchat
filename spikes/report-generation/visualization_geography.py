"""Validate query-provided GeoJSON used by geographic visualizations."""

from __future__ import annotations

import json


def valid_geojson_geometry(value: object) -> bool:
    """Accept a closed GeoJSON Polygon/MultiPolygon supplied by the query result."""
    if not isinstance(value, str):
        return False
    try:
        geometry = json.loads(value)
    except (TypeError, ValueError):
        return False

    def valid_ring(ring: object) -> bool:
        return (
            isinstance(ring, list)
            and len(ring) >= 4
            and ring[0] == ring[-1]
            and all(
                isinstance(point, list)
                and len(point) >= 2
                and all(isinstance(coordinate, (int, float)) for coordinate in point[:2])
                and -180 <= point[0] <= 180
                and -90 <= point[1] <= 90
                for point in ring
            )
        )

    if not isinstance(geometry, dict):
        return False
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon":
        polygons = [coordinates]
    elif geometry.get("type") == "MultiPolygon":
        polygons = coordinates
    else:
        return False
    return bool(polygons) and all(
        isinstance(polygon, list) and polygon and all(valid_ring(ring) for ring in polygon)
        for polygon in polygons
    )


def valid_geojson_map(value: object) -> bool:
    """Accept query-provided polygon geometry, Feature, or FeatureCollection."""
    if valid_geojson_geometry(value):
        return True
    if not isinstance(value, str):
        return False
    try:
        document = json.loads(value)
    except (TypeError, ValueError):
        return False
    if not isinstance(document, dict):
        return False
    if document.get("type") == "Feature":
        return valid_geojson_geometry(json.dumps(document.get("geometry")))
    if document.get("type") != "FeatureCollection":
        return False
    features = document.get("features")
    return bool(features) and all(
        isinstance(feature, dict)
        and feature.get("type") == "Feature"
        and valid_geojson_geometry(json.dumps(feature.get("geometry")))
        for feature in features
    )
