from django.core.exceptions import ValidationError

def validate_shapefile(value):
    allowed_extensions = ['.shp', '.shx', '.dbf', '.prj', '.cpg']
    for file in value:
        if not any(file.name.endswith(ext) for ext in allowed_extensions):
            raise ValidationError('Only shapefiles are allowed.')