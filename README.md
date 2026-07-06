# Astro Eyepiece Prototype

This is a first-pass software and industrial-design prototype for a handheld astrophotography learning eyepiece.

## What it does

- Shows a live camera preview when the browser permits camera access.
- Takes manual or sensor-sourced pointing values: azimuth and altitude.
- Uses the user's latitude and longitude.
- Converts horizontal coordinates to J2000-style RA/Dec for the current time.
- Sends the coordinate to NASA SkyView, a free no-key survey cutout service.
- Places the returned sky image back into the live-view frame.
- Searches a built-in beginner target catalog by Messier/NGC/common name.
- Guides the user toward a selected target with arrows and a target dot.
- Draws deep-sky object circles and simplified constellation lines over the returned sky image.

## Prototype files

- `index.html`, `styles.css`, `app.js`: browser prototype.
- `catalog.js`: beginner deep-sky target catalog and constellation line data.
- `model/astro_eyepiece.obj`: 3D concept mesh.
- `model/astro_eyepiece.mtl`: material assignments.
- `model/astro_eyepiece.stl`: printable-style single-material shell concept.
- `model/blueprint.svg`: labeled concept drawing.
- `generate_model.py`: model generator so dimensions can be changed later.

## Hardware assumptions

The future hardware would provide:

- Camera feed from a small low-light sensor.
- Azimuth from a calibrated magnetometer or compass module.
- Altitude from an IMU/accelerometer.
- Location from phone pairing or GNSS.
- A trigger button.
- A small display or micro-OLED eyepiece panel.

Phone/browser sensors are noisy, so this prototype is best treated as a product interaction demo and software proof of concept. A real version should add plate solving from the live camera frame to refine the pointing after the first estimate.

## Sky image API

The app uses NASA SkyView:

`https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=<ra>,<dec>&Survey=DSS2%20Red&Coordinates=J2000&Projection=Tan&Size=2&Pixels=768&Return=JPEG`

SkyView has many surveys. `DSS2 Red` is a good visible-light default, while `2MASS-K`, `WISE 12`, and `GALEX Near UV` make the same sky area feel more like a multiwavelength astronomy tool.

## Run it

Serve the folder from localhost. Camera and location permissions usually work from `localhost`, but may not work from a direct `file://` open.
