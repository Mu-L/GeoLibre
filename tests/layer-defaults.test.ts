import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_LAYER_STYLE,
  LAYER_PALETTE,
  darkenHex,
  dominantGeometry,
  initialLayerStyle,
  nextLayerPaletteColor,
  useAppStore,
  type GeoLibreLayer,
} from "@geolibre/core";
import type { FeatureCollection } from "geojson";

function styled(id: string, fillColor: string): GeoLibreLayer {
  return {
    id,
    name: id,
    type: "geojson",
    source: { type: "geojson" },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE, fillColor },
    metadata: {},
  };
}

function fc(types: string[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: types.map((type) => ({
      type: "Feature",
      geometry:
        type === "Point"
          ? { type: "Point", coordinates: [0, 0] }
          : type === "LineString"
            ? {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              }
            : {
                type: "Polygon",
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                  ],
                ],
              },
      properties: {},
    })),
  } as FeatureCollection;
}

describe("darkenHex", () => {
  it("darkens each channel toward black", () => {
    assert.equal(darkenHex("#ffffff", 0.5), "#808080");
    assert.equal(darkenHex("#3b82f6", 0.55), "#204887");
  });

  it("leaves a value it cannot parse untouched", () => {
    assert.equal(darkenHex("rgb(1,2,3)", 0.5), "rgb(1,2,3)");
    assert.equal(darkenHex("#abc", 0.5), "#abc");
  });
});

describe("nextLayerPaletteColor", () => {
  it("starts at the historical default so the first layer looks unchanged", () => {
    assert.equal(nextLayerPaletteColor([]), DEFAULT_LAYER_STYLE.fillColor);
    assert.equal(nextLayerPaletteColor([]), LAYER_PALETTE[0]);
  });

  it("skips colors already in use", () => {
    assert.equal(nextLayerPaletteColor([styled("a", LAYER_PALETTE[0])]), LAYER_PALETTE[1]);
    assert.equal(
      nextLayerPaletteColor([styled("a", LAYER_PALETTE[0]), styled("b", LAYER_PALETTE[1])]),
      LAYER_PALETTE[2],
    );
  });

  it("reuses a color freed by a deleted layer instead of drifting", () => {
    // b was removed; its color should come back rather than the cycle staying
    // permanently offset.
    const remaining = [styled("a", LAYER_PALETTE[0]), styled("c", LAYER_PALETTE[2])];
    assert.equal(nextLayerPaletteColor(remaining), LAYER_PALETTE[1]);
  });

  it("matches a used color case-insensitively", () => {
    assert.equal(
      nextLayerPaletteColor([styled("a", LAYER_PALETTE[0].toUpperCase())]),
      LAYER_PALETTE[1],
    );
  });

  it("cycles once the whole palette is in use", () => {
    const all = LAYER_PALETTE.map((color, index) => styled(`l${index}`, color));
    assert.ok(LAYER_PALETTE.includes(nextLayerPaletteColor(all) as (typeof LAYER_PALETTE)[number]));
  });
});

describe("dominantGeometry", () => {
  it("classifies a clear majority", () => {
    assert.equal(dominantGeometry(fc(["Point", "Point", "Point"])), "point");
    assert.equal(dominantGeometry(fc(["LineString", "LineString"])), "line");
    assert.equal(dominantGeometry(fc(["Polygon", "Polygon", "Point"])), "polygon");
  });

  it("reports mixed when nothing holds a majority", () => {
    assert.equal(dominantGeometry(fc(["Point", "LineString"])), "mixed");
    assert.equal(dominantGeometry(fc([])), "mixed");
    assert.equal(dominantGeometry(undefined), "mixed");
  });
});

describe("initialLayerStyle", () => {
  it("gives a point layer solid, smaller symbols", () => {
    const style = initialLayerStyle({ geojson: fc(["Point", "Point"]) });
    assert.equal(style.circleRadius, 5);
    assert.equal(style.fillOpacity, 0.9);
  });

  it("gives a polygon layer a translucent fill so the basemap reads through", () => {
    const style = initialLayerStyle({ geojson: fc(["Polygon", "Polygon"]) });
    assert.equal(style.fillOpacity, 0.45);
    assert.equal(style.strokeWidth, 1.5);
  });

  it("puts the weight on a line layer's stroke", () => {
    assert.equal(initialLayerStyle({ geojson: fc(["LineString"]) }).strokeWidth, 2.5);
  });

  it("derives the outline from the assigned fill", () => {
    const style = initialLayerStyle({ layers: [styled("a", LAYER_PALETTE[0])] });
    assert.equal(style.fillColor, LAYER_PALETTE[1]);
    assert.equal(style.strokeColor, darkenHex(LAYER_PALETTE[1], 0.55));
  });

  it("fills every schema key so a layer style is never partial", () => {
    const style = initialLayerStyle();
    for (const key of Object.keys(DEFAULT_LAYER_STYLE)) {
      assert.ok(key in style, key);
    }
  });

  it("lets overrides win over the computed defaults", () => {
    const style = initialLayerStyle({
      geojson: fc(["Point"]),
      overrides: { fillOpacity: 0.1, fillColor: "#000000" },
    });
    assert.equal(style.fillOpacity, 0.1);
    assert.equal(style.fillColor, "#000000");
  });
});

describe("addGeoJsonLayer", () => {
  beforeEach(() => {
    useAppStore.setState({ layers: [] });
  });

  it("gives each added layer its own color", () => {
    useAppStore.getState().addGeoJsonLayer("a", fc(["Polygon"]));
    useAppStore.getState().addGeoJsonLayer("b", fc(["Polygon"]));
    useAppStore.getState().addGeoJsonLayer("c", fc(["Polygon"]));

    const colors = useAppStore.getState().layers.map((layer) => layer.style.fillColor);
    assert.equal(new Set(colors).size, 3, `expected distinct colors, got ${colors.join(", ")}`);
    assert.equal(colors[0], LAYER_PALETTE[0]);
  });

  it("sizes an added layer for its geometry", () => {
    useAppStore.getState().addGeoJsonLayer("points", fc(["Point", "Point"]));
    const layer = useAppStore.getState().layers[0];
    assert.equal(layer.style.circleRadius, 5);
    assert.equal(layer.style.fillOpacity, 0.9);
  });
});
