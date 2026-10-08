"""Reading, describing and filtering as-applied session layers (stored by artof_utils.as_applied) for the web pages."""
import json
import math

import numpy as np
from artof_utils import as_applied

# A column with at most this many distinct values is offered as a list of values to pick from
MAX_CHOICES = 40


class AppliedError(ValueError):
    """Request for a layer, column or filter that does not exist; shown to the user."""


def column_kind(dtype: str) -> str:
    if dtype == 'bool':
        return 'bool'
    if dtype.startswith(('int', 'uint', 'float')):
        return 'number'
    return 'text'


def layer_columns(field_name: str, session: str, layer: str) -> tuple:
    """({name: kind} of the attribute columns (kind: number, bool or text), feature count) of a layer."""
    try:
        info = as_applied.layer_info(field_name, session, layer)
    except ValueError as error:
        raise AppliedError(str(error))
    except Exception:
        raise AppliedError("As-applied session '%s' has no %s layer" % (session, layer))
    return {name: column_kind(dtype) for name, dtype in info['columns'].items()}, info['count']


def check_columns(columns: dict, names) -> None:
    unknown = [name for name in names if name not in columns]
    if unknown:
        raise AppliedError('Unknown attribute: %s' % ', '.join(unknown))


def json_value(value):
    """Plain JSON value of a pandas/numpy cell (NaN becomes None)."""
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def attribute_summary(field_name: str, session: str, layer: str, name: str) -> dict:
    """Kind, range and (when few) distinct values of one attribute, to build a filter or legend."""
    columns, _ = layer_columns(field_name, session, layer)
    check_columns(columns, [name])
    series = as_applied.read_layer(field_name, session, layer, columns=[name])[name]
    kind = columns[name]
    summary = {'name': name, 'kind': kind}
    if kind == 'number':
        summary['min'] = json_value(series.min())
        summary['max'] = json_value(series.max())
    distinct = series.dropna().unique()
    if kind == 'bool':
        summary['values'] = sorted(str(bool(value)).lower() for value in distinct)
    elif len(distinct) <= MAX_CHOICES:
        summary['values'] = sorted(json_value(value) for value in distinct)
    return summary


def parse_filters(raw: str) -> list:
    try:
        filters = json.loads(raw or '[]')
    except ValueError:
        raise AppliedError('Invalid filters')
    if not isinstance(filters, list) or not all(isinstance(f, dict) and 'name' in f for f in filters):
        raise AppliedError('Invalid filters')
    return filters


def apply_filter(gdf, columns: dict, f: dict):
    series = gdf[f['name']]
    if 'values' in f:
        if columns[f['name']] == 'bool':
            return series.isin([str(value).lower() == 'true' for value in f['values']])
        if columns[f['name']] == 'number':
            return series.isin([float(value) for value in f['values']])
        return series.astype(str).isin([str(value) for value in f['values']])
    mask = series.notna()
    if f.get('min') is not None:
        mask &= series >= float(f['min'])
    if f.get('max') is not None:
        mask &= series <= float(f['max'])
    return mask


def filtered_features(field_name: str, session: str, layer: str, color: str = '', filters: list = ()) -> tuple:
    """
    WGS84 GeoJSON of the features that pass all filters, with only their fid and the value of `color` as properties.
    Returns (geojson string, number of features shown, number of features in the layer).
    """
    columns, count = layer_columns(field_name, session, layer)
    names = list(dict.fromkeys(([color] if color else []) + [f['name'] for f in filters]))
    check_columns(columns, names)
    try:
        gdf = as_applied.read_layer(field_name, session, layer, columns=names)
        for f in filters:
            gdf = gdf[apply_filter(gdf, columns, f)]
    except (TypeError, ValueError):
        raise AppliedError('Invalid filter value')
    gdf = gdf.assign(fid=gdf.index, value=gdf[color] if color else None)[['fid', 'value', 'geometry']]
    return gdf.to_crs('EPSG:4326').to_json(drop_id=True), len(gdf), count


def feature_properties(field_name: str, session: str, layer: str, fid: int) -> dict:
    layer_columns(field_name, session, layer)
    try:
        gdf = as_applied.read_layer(field_name, session, layer, fids=[fid])
    except Exception:
        gdf = None
    if gdf is None or gdf.empty:
        raise AppliedError('Feature %d does not exist' % fid)
    row = gdf.drop(columns='geometry').iloc[0]
    return {name: json_value(value) for name, value in row.items()}
