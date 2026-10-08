"""
Shapefile handling that keeps the attribute table (DBF columns) of field shapes.

artof_utils.Shapefile.update() rebuilds a shapefile from coordinates as geometry only, which drops all
attributes. The helpers here store uploaded files as GeoDataFrames and re-attach attributes after
coordinate based edits.
"""
import os
import tempfile

import geopandas as gpd
import pandas as pd
from django.core.exceptions import ValidationError
from pyproj import CRS, Transformer

from artof_utils.schemas.settings import HitchType, load_settings

from ..forms.validators import validate_shapefile


class ShapefileError(Exception):
    """Invalid shapefile upload; the message is shown to the user."""


def utm_crs():
    """The CRS the robot works in: UTM zone (north) from the platform settings."""
    return CRS('EPSG:326%d' % load_settings().gps.utm_zone)


def task_geom_type(task_type):
    """Geometry type of a task's shapefile: points for discrete and intermittent tasks, polygons otherwise."""
    return 'Point' if task_type in (HitchType.DISCRETE, HitchType.INTERMITTENT) else 'Polygon'


def load_uploaded_gdf(files):
    """Reads uploaded shapefile parts (.shp, .shx, .dbf, .prj, .cpg) into a GeoDataFrame, attributes included."""
    if not files:
        raise ShapefileError('No files were uploaded.')
    try:
        validate_shapefile(files)
    except ValidationError:
        raise ShapefileError('Only shapefile parts (.shp, .shx, .dbf, .prj, .cpg) can be uploaded.')

    with tempfile.TemporaryDirectory() as folder:
        shp_path = None
        for file in files:
            file_path = os.path.join(folder, os.path.basename(file.name))
            with open(file_path, 'wb') as destination:
                for chunk in file.chunks():
                    destination.write(chunk)
            if file_path.lower().endswith('.shp'):
                shp_path = file_path

        if shp_path is None:
            raise ShapefileError('The upload has no .shp file.')
        try:
            gdf = gpd.read_file(shp_path)
        except Exception as error:
            raise ShapefileError(f'The shapefile could not be read: {error}')

    if gdf.crs is None:
        raise ShapefileError('The shapefile has no coordinate system: upload its .prj file too.')
    if gdf.empty:
        raise ShapefileError('The shapefile has no features.')
    return gdf


def prepare_upload(gdf, geom_type=None):
    """
    Makes an uploaded GeoDataFrame storable as `geom_type` ('LineString', 'Polygon' or 'Point'; None
    accepts any single type), keeping its attributes and its coordinate system.

    Multi-part features are split into single parts that each keep the feature's attributes. A file in a
    geographic coordinate system (degrees) is reprojected to the robot's UTM zone, because artof_utils
    and the map operations need metric x/y coordinates. Returns (gdf, note) with a note for the user.
    """
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    if gdf.geom_type.str.startswith('Multi').any():
        gdf = gdf.explode(index_parts=False)
    gdf = gdf.reset_index(drop=True)
    if gdf.empty:
        raise ShapefileError('The shapefile has no features.')

    types = set(gdf.geom_type)
    expected = {geom_type} if geom_type else types
    if types != expected or len(types) > 1:
        raise ShapefileError(f'Expected {geom_type or "one geometry type"}, but the shapefile contains {", ".join(sorted(types))}.')

    note = ''
    if gdf.crs.is_geographic:
        target = utm_crs()
        note = f'Converted from {gdf.crs.name} to {target.name}.'
        gdf = gdf.to_crs(target)
    return gdf, note


def sync_geom_type(shapefile):
    """
    artof_utils' Shapefile.update(gdf) replaces the data but not the cached geom_type that Shapefile.context
    uses: refresh it after storing a GeoDataFrame.
    """
    shapefile.geom_type = shapefile.get_geom_type()


def attribute_table(gdf):
    """The attribute columns of `gdf`, without GDAL's automatic FID of a geometry-only shapefile."""
    attributes = pd.DataFrame(gdf.drop(columns=gdf.geometry.name)).reset_index(drop=True)
    if list(attributes.columns) == ['FID'] and list(attributes['FID']) == list(range(len(attributes))):
        return attributes.drop(columns=['FID'])
    return attributes


def with_attributes(gdf, attributes):
    """
    `gdf` with the rows of `attributes`: row by row when the number of features is the same,
    otherwise every feature gets the first row.
    """
    if attributes.columns.empty or attributes.empty:
        return gdf
    if len(attributes) == len(gdf):
        rows = attributes
    else:
        rows = attributes.iloc[[0] * len(gdf)]
    return gpd.GeoDataFrame(rows.reset_index(drop=True), geometry=list(gdf.geometry), crs=gdf.crs)


def preserving_attributes(shapefile, update):
    """
    Runs `update()`, a coordinate based update of `shapefile` (artof_utils.shapefile.Shapefile),
    and puts the attributes it had before back on the new features.
    """
    attributes = attribute_table(shapefile.gdf)
    update()
    if not attributes.columns.empty:
        shapefile.update(with_attributes(shapefile.gdf, attributes))


def xy_to_crs(coordinates, from_crs, to_crs):
    """Transforms nested [x, y] coordinate lists between coordinate systems, always in x/y (easting/northing) order."""
    from_crs, to_crs = CRS(from_crs), CRS(to_crs)
    if from_crs == to_crs:
        return coordinates
    transformer = Transformer.from_crs(from_crs, to_crs, always_xy=True)

    def transform(value):
        if value and isinstance(value[0], (list, tuple)):
            return [transform(item) for item in value]
        return list(transformer.transform(value[0], value[1]))

    return transform(coordinates)


# Per-feature attribute that the robot uses for each task type: (column, value type, default)
TASK_ATTRIBUTES = {
    HitchType.CONTINUOUS: ('rate', float, 100.0),
    HitchType.CARDAN: ('rate', float, 100.0),
    HitchType.DISCRETE: ('routine', int, 1),
    HitchType.INTERMITTENT: ('routine', int, 1),
}


def _attribute_column(gdf, name):
    """The existing column for attribute `name` (case-insensitive, e.g. 'Rate'), or `name` itself."""
    return next((column for column in gdf.columns if str(column).lower() == name), name)


def _cast(kind, value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ShapefileError(f'"{value}" is not a number.')
    if kind is int and not number.is_integer():
        raise ShapefileError(f'{value} is not a whole number.')
    return kind(number)


def task_attribute(task):
    """
    The rate (continuous, cardan) or routine (discrete, intermittent) of every feature of `task`, with the
    default for features that have none, as {name, type, default, values, stored}; None for other task types.
    """
    spec = TASK_ATTRIBUTES.get(task.type)
    if spec is None:
        return None
    name, kind, default = spec
    shapefile = task.shp_task
    gdf = shapefile.gdf
    column = _attribute_column(gdf, name)

    if shapefile.empty:
        values, stored = [], True
    elif column in gdf.columns:
        values = [default if pd.isna(value) else kind(value) for value in gdf[column]]
        stored = bool(gdf[column].notna().all())
    else:
        values, stored = [default] * len(gdf), False
    return {'name': name, 'type': kind.__name__, 'default': default, 'values': values, 'stored': stored}


def set_task_attribute(task, values=None):
    """
    Stores the rate/routine of every feature of `task` in its shapefile: `values` in feature order,
    or (None) the current values with the default for features that have none.
    """
    attribute = task_attribute(task)
    shapefile = task.shp_task
    if attribute is None or shapefile.empty:
        return
    if values is None:
        if attribute['stored']:
            return
        values = attribute['values']

    gdf = shapefile.gdf
    if len(values) != len(gdf):
        raise ShapefileError(f'Expected {len(gdf)} values, one per feature, but got {len(values)}.')
    kind = TASK_ATTRIBUTES[task.type][1]
    gdf = gdf.copy()
    gdf[_attribute_column(gdf, attribute['name'])] = [_cast(kind, value) for value in values]
    shapefile.update(gdf)
    sync_geom_type(shapefile)
