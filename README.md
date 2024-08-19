# ARTOF python utils

## Introduction

This Django application is the system add-on web app of the [ARTOF](https://artof-ilvo.github.io) project.

## Usage (Docker)

```bash
docker pull axelwillekens/artof-system:latest
docker run --network=host -v /var/lib/ilvo:/var/lib/ilvo gitlab.ilvo.be:5050/artof-ilvo/addons/system:latest
```

## Debug (vscode)

To debug this project in visual studio code:

1. Create a `.env` file in the root of the project.

```
ILVO_PATH=/var/lib/ilvo
DEBUG=1
PORT=8000
```

2. Configure tha `.vscode/launch.json` file

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: Django",
            "type": "python",
            "request": "launch",
            "env": {},
            "envFile": "${workspaceFolder}/.env",
            "program": "${workspaceFolder}/manage.py",
            "args": [
                "runserver",
                "8000"
            ],
            "django": true,
            "justMyCode": true
        }
    ]
}
```

## Licence

This project is under the ``ILVO LICENCE``.

```
Copyright (c) 2024 Flanders Research Institute for Agriculture, Fisheries and Food (ILVO)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

When the Software, including modifications and extensions, is used for:
- commercial or non-commercial machinery: the ILVO logo has to be clearly
   visible on the machine or on any promotion material which may be used in any
   agricultural fair or conference, in a way it is clear that ILVO contributed
   to the development of the software for the machine.
- a scientific or vulgarising publication: a reference to ILVO must be made as
   well as to the website of the living lab Agrifood Technology of ILVO:
   https://www.agrifoodtechnology.be

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```