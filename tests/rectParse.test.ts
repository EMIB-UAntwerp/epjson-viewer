import { describe, expect, it } from 'vitest'
import { parseEpjson } from '../src/core/parse'

/**
 * A single rectangular wall (World coordinates, no zone rotation, no building
 * rotation) so every geometric assertion below can reason in plain world
 * coordinates. Individual tests splice in the object(s) they need.
 */
function baseModel(): Record<string, unknown> {
  return {
    Building: { B: { north_axis: 0 } },
    GlobalGeometryRules: {
      Rules: {
        coordinate_system: 'World',
        rectangular_surface_coordinate_system: 'World',
        vertex_entry_direction: 'Counterclockwise',
      },
    },
    Zone: { Zn1: { x_origin: 0, y_origin: 0, z_origin: 0 } },
  }
}

/** Facing north (+Y), vertical, 4 wide × 3 tall, lower-left corner at the origin. */
function wallExterior(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    zone_name: 'Zn1',
    construction_name: 'C1',
    starting_x_coordinate: 0,
    starting_y_coordinate: 0,
    starting_z_coordinate: 0,
    length: 4,
    height: 3,
    azimuth_angle: 0,
    tilt_angle: 90,
    ...extra,
  }
}

describe('parseEpjson: rectangular heat-transfer surfaces', () => {
  it('reads the boundary condition from the object type, not a field, for every family', () => {
    const json = baseModel()
    json['Wall:Exterior'] = { W1: wallExterior() }
    json['Wall:Adiabatic'] = { W2: wallExterior() }
    json['Wall:Underground'] = { W3: wallExterior() }
    json['Wall:Interzone'] = { W4: wallExterior({ outside_boundary_condition_object: 'SomeOtherWall' }) }
    json.Roof = { R1: wallExterior({ tilt_angle: undefined, azimuth_angle: undefined, height: undefined, width: 3 }) }
    json['Floor:GroundContact'] = { F1: wallExterior({ tilt_angle: undefined, height: undefined, width: 3 }) }
    json['Ceiling:Interzone'] = {
      C1: wallExterior({ tilt_angle: undefined, height: undefined, width: 3, outside_boundary_condition_object: 'Above' }),
    }

    const model = parseEpjson(json, 'x.epJSON')
    const byName = (n: string) => model.surfaces.find((s) => s.name === n)!

    expect(byName('W1').boundaryCondition).toBe('Outdoors')
    expect(byName('W1').isInterior).toBe(false)
    expect(byName('W2').boundaryCondition).toBe('Adiabatic')
    expect(byName('W3').boundaryCondition).toBe('Ground')
    expect(byName('W4').boundaryCondition).toBe('Surface')
    expect(byName('W4').boundaryObject).toBe('SomeOtherWall')
    expect(byName('W4').isInterior).toBe(true)

    // Roof/Floor/Ceiling default their tilt per family (0 / 180 / 0) when
    // tilt_angle is absent, and read `width` rather than `height`.
    expect(byName('R1').tilt).toBeCloseTo(0)
    expect(byName('R1').category).toBe('roof')
    expect(byName('R1').boundaryCondition).toBe('Outdoors')
    expect(byName('F1').tilt).toBeCloseTo(180)
    expect(byName('F1').category).toBe('floor')
    expect(byName('F1').boundaryCondition).toBe('Ground')
    expect(byName('C1').category).toBe('ceiling')
    expect(byName('C1').boundaryCondition).toBe('Surface')
    expect(byName('C1').boundaryObject).toBe('Above')
  })

  it('recovers area, tilt and azimuth from the declared inputs (round trip through the parser)', () => {
    const json = baseModel()
    json['Wall:Exterior'] = { W1: wallExterior() }
    const model = parseEpjson(json, 'x.epJSON')
    const wall = model.surfaces.find((s) => s.name === 'W1')!
    expect(wall.area).toBeCloseTo(12)
    expect(wall.tilt).toBeCloseTo(90)
    expect(wall.azimuth).toBeCloseTo(0)
  })

  it('warns and skips a rectangular surface with zero length or height', () => {
    const json = baseModel()
    // A valid surface alongside the degenerate one so the model isn't empty.
    json['Wall:Exterior'] = { Good: wallExterior({ starting_x_coordinate: 20 }), W1: wallExterior({ length: 0 }) }
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.find((s) => s.name === 'W1')).toBeUndefined()
    expect(model.warnings.some((w) => w.includes('W1'))).toBe(true)
  })
})

describe('parseEpjson: rectangular subsurfaces', () => {
  function withWindow(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const json = baseModel()
    json['Wall:Exterior'] = { Wall1: wallExterior() }
    json.Window = {
      Win1: {
        building_surface_name: 'Wall1',
        starting_x_coordinate: 1,
        starting_z_coordinate: 1,
        length: 2,
        height: 1,
        ...extra,
      },
    }
    return json
  }

  it('cuts a hole in its base and reduces netArea by exactly its own area', () => {
    const model = parseEpjson(withWindow(), 'x.epJSON')
    const wall = model.surfaces.find((s) => s.name === 'Wall1')!
    const win = model.surfaces.find((s) => s.name === 'Win1')!
    expect(win.area).toBeCloseTo(2)
    expect(wall.holes.length).toBe(1)
    expect(wall.netArea).toBeCloseTo(wall.area - win.area)
    expect(win.hostSurface).toBe('Wall1')
    expect(win.category).toBe('window')
  })

  it('resolves its base surface case-insensitively, exact match winning when both exist', () => {
    const json = withWindow({ building_surface_name: 'WALL1' })
    const model = parseEpjson(json, 'x.epJSON')
    const win = model.surfaces.find((s) => s.name === 'Win1')!
    // hostSurface stores the resolved surface's own name, not the raw
    // reference string, so a folded match still points at the real wall.
    expect(win.hostSurface).toBe('Wall1')
    expect(model.surfaces.find((s) => s.name === 'Wall1')!.holes.length).toBe(1)
  })

  it('warns and skips when the named base surface does not exist', () => {
    const json = withWindow({ building_surface_name: 'NoSuchWall' })
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.find((s) => s.name === 'Win1')).toBeUndefined()
    expect(model.warnings.some((w) => w.includes('Win1') && w.includes('NoSuchWall'))).toBe(true)
  })

  it('warns once, in aggregate, when several subsurfaces land on a near-horizontal base', () => {
    const json = baseModel()
    json['Roof'] = { Roof1: wallExterior({ tilt_angle: 0, height: undefined, width: 3 }) }
    json.Window = {
      Sky1: { building_surface_name: 'Roof1', starting_x_coordinate: 0, starting_z_coordinate: 0, length: 1, height: 1 },
      Sky2: { building_surface_name: 'Roof1', starting_x_coordinate: 1, starting_z_coordinate: 1, length: 1, height: 1 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    const matches = model.warnings.filter((w) => w.includes('near-horizontal'))
    expect(matches.length).toBe(1)
    expect(matches[0]).toContain('2')
  })

  it('categorizes Door as a door and GlazedDoor as a window (it is glazing, not a door)', () => {
    const json = baseModel()
    json['Wall:Exterior'] = { Wall1: wallExterior() }
    json.Door = {
      D1: { building_surface_name: 'Wall1', starting_x_coordinate: 0, starting_z_coordinate: 0, length: 1, height: 2 },
    }
    json.GlazedDoor = {
      G1: { building_surface_name: 'Wall1', starting_x_coordinate: 2, starting_z_coordinate: 0, length: 1, height: 2 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.find((s) => s.name === 'D1')!.category).toBe('door')
    expect(model.surfaces.find((s) => s.name === 'G1')!.category).toBe('window')
  })

  it('takes the boundary condition of an :Interzone subsurface from its own object type, not its base', () => {
    const json = withWindow() // Wall1 is Wall:Exterior — boundaryCondition 'Outdoors'
    json['Window:Interzone'] = {
      WinIz: { building_surface_name: 'Wall1', starting_x_coordinate: 0, starting_z_coordinate: 0, length: 1, height: 1, outside_boundary_condition_object: 'OtherZoneWindow' },
    }
    json['Door:Interzone'] = {
      DoorIz: { building_surface_name: 'Wall1', starting_x_coordinate: 2, starting_z_coordinate: 0, length: 1, height: 1, outside_boundary_condition_object: 'OtherZoneDoor' },
    }
    json['GlazedDoor:Interzone'] = {
      GDIz: { building_surface_name: 'Wall1', starting_x_coordinate: 3, starting_z_coordinate: 1.5, length: 0.5, height: 0.5, outside_boundary_condition_object: 'OtherZoneGD' },
    }
    const model = parseEpjson(json, 'x.epJSON')
    for (const [name, obj] of [['WinIz', 'OtherZoneWindow'], ['DoorIz', 'OtherZoneDoor'], ['GDIz', 'OtherZoneGD']] as const) {
      const s = model.surfaces.find((x) => x.name === name)!
      expect(s.boundaryCondition).toBe('Surface')
      expect(s.boundaryObject).toBe(obj)
      expect(s.isInterior).toBe(true)
    }
  })

  it('parses a file containing rectangular geometry and no detailed objects at all', () => {
    // No BuildingSurface:Detailed, Wall:Detailed, etc. anywhere in the file —
    // this used to be exactly the shape that hit the "no surface objects"
    // throw before rectangular objects counted as surface objects too.
    const json = withWindow()
    expect(() => parseEpjson(json, 'x.epJSON')).not.toThrow()
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.length).toBeGreaterThan(0)
    expect(model.surfaces.some((s) => s.epType === 'BuildingSurface:Detailed')).toBe(false)
  })
})

describe('parseEpjson: rectangular detached shading', () => {
  it('never rotates Shading:Site but rotates Shading:Building with the building', () => {
    const json = baseModel()
    ;(json.Building as Record<string, unknown>).B = { north_axis: 90 }
    json['GlobalGeometryRules'] = {
      Rules: { coordinate_system: 'World', rectangular_surface_coordinate_system: 'Relative' },
    }
    // Both objects are the same rectangle so any positional difference is
    // attributable purely to the rotation rule, not the geometry.
    const rect = { starting_x_coordinate: 5, starting_y_coordinate: 0, starting_z_coordinate: 0, length: 2, height: 2, azimuth_angle: 0, tilt_angle: 90 }
    json['Shading:Site'] = { Site1: { ...rect } }
    json['Shading:Building'] = { Bldg1: { ...rect } }
    const model = parseEpjson(json, 'x.epJSON')
    const site = model.surfaces.find((s) => s.name === 'Site1')!
    const bldg = model.surfaces.find((s) => s.name === 'Bldg1')!
    const c = model.meta.center
    // Site keeps its declared x=5; building shading rotates -90° clockwise
    // about the origin (north_axis 90, Relative rectangular system): (5,0)->(0,-5).
    expect(site.polygon[0] + c[0]).toBeCloseTo(5)
    expect(bldg.polygon[0] + c[0]).toBeCloseTo(0, 3)
    expect(bldg.polygon[1] + c[1]).toBeCloseTo(-5, 3)
  })

  it('warns exactly once when coordinate_system and rectangular_surface_coordinate_system disagree and the file has rectangular geometry', () => {
    const json = baseModel()
    json['GlobalGeometryRules'] = {
      Rules: { coordinate_system: 'World', rectangular_surface_coordinate_system: 'Relative' },
    }
    json['Shading:Site'] = {
      Site1: { starting_x_coordinate: 0, starting_y_coordinate: 0, starting_z_coordinate: 0, length: 2, height: 2, azimuth_angle: 0, tilt_angle: 90 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    const matches = model.warnings.filter((w) => w.includes('disagree'))
    expect(matches.length).toBe(1)
  })

  it('stays silent about the same mismatch when the file has no rectangular geometry at all', () => {
    const json = baseModel()
    json['GlobalGeometryRules'] = {
      Rules: { coordinate_system: 'World', rectangular_surface_coordinate_system: 'Relative' },
    }
    json['BuildingSurface:Detailed'] = {
      Wall1: {
        surface_type: 'Wall',
        zone_name: 'Zn1',
        outside_boundary_condition: 'Outdoors',
        vertices: [
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 3 },
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 3 },
        ],
      },
    }
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.warnings.some((w) => w.includes('disagree'))).toBe(false)
  })

  it('warns and skips a rectangular shade with zero length or height', () => {
    const json = baseModel()
    json['Wall:Exterior'] = { Wall1: wallExterior() }
    json['Shading:Site'] = {
      Site1: { starting_x_coordinate: 0, starting_y_coordinate: 0, starting_z_coordinate: 0, length: 0, height: 2, azimuth_angle: 0, tilt_angle: 90 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.find((s) => s.name === 'Site1')).toBeUndefined()
    expect(model.warnings.some((w) => w.includes('Site1'))).toBe(true)
  })
})

describe('parseEpjson: attached parametric shading (overhang, fin)', () => {
  function withWindow(): Record<string, unknown> {
    const json = baseModel()
    json['Wall:Exterior'] = { Wall1: wallExterior() }
    json.Window = {
      Win1: { building_surface_name: 'Wall1', starting_x_coordinate: 1, starting_z_coordinate: 1, length: 2, height: 1 },
    }
    return json
  }

  it('places an overhang on the window frame and reports it facing up at the default tilt', () => {
    const json = withWindow()
    json['Shading:Overhang'] = {
      Ov1: { window_or_door_name: 'Win1', height_above_window_or_door: 0, tilt_angle_from_window_door: 90, left_extension_from_window_door_width: 0, right_extension_from_window_door_width: 0, depth: 1 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    const ov = model.surfaces.find((s) => s.name === 'Ov1')!
    expect(ov.category).toBe('shading')
    expect(ov.hostSurface).toBe('Win1')
    expect(ov.tilt).toBeCloseTo(0)
    expect(ov.area).toBeCloseTo(2) // 1m deep x 2m window width, no extensions
  })

  it('silently drops an overhang whose depth resolves to zero — no warning', () => {
    const json = withWindow()
    json['Shading:Overhang'] = {
      Ov1: { window_or_door_name: 'Win1', depth: 0 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.find((s) => s.name === 'Ov1')).toBeUndefined()
    expect(model.warnings.some((w) => w.includes('Ov1'))).toBe(false)
  })

  it('warns and skips an overhang whose window/door reference does not resolve', () => {
    const json = withWindow()
    json['Shading:Overhang'] = {
      Ov1: { window_or_door_name: 'NoSuchWindow', depth: 1 },
    }
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.surfaces.find((s) => s.name === 'Ov1')).toBeUndefined()
    expect(model.warnings.some((w) => w.includes('Ov1') && w.includes('NoSuchWindow'))).toBe(true)
  })

  it('drops only the zero-depth side of a fin, keeping the other', () => {
    const json = withWindow()
    json['Shading:Fin'] = {
      Fin1: {
        window_or_door_name: 'Win1',
        left_extension_from_window_door: 0,
        left_distance_above_top_of_window: 0,
        left_distance_below_bottom_of_window: 0,
        left_tilt_angle_from_window_door: 90,
        left_depth: 0.5,
        right_extension_from_window_door: 0,
        right_distance_above_top_of_window: 0,
        right_distance_below_bottom_of_window: 0,
        right_tilt_angle_from_window_door: 90,
        right_depth: 0, // dropped, like EnergyPlus does
      },
    }
    const model = parseEpjson(json, 'x.epJSON')
    const left = model.surfaces.find((s) => s.name === 'Fin1 Left')
    const right = model.surfaces.find((s) => s.name === 'Fin1 Right')
    expect(left).toBeDefined()
    expect(right).toBeUndefined()
    expect(left!.hostSurface).toBe('Win1')
    expect(left!.category).toBe('shading')
  })

  it('emits two named surfaces for a fin with both sides present, sharing one raw object', () => {
    const json = withWindow()
    const finRaw = {
      window_or_door_name: 'Win1',
      left_extension_from_window_door: 0,
      left_distance_above_top_of_window: 0,
      left_distance_below_bottom_of_window: 0,
      left_tilt_angle_from_window_door: 90,
      left_depth: 0.5,
      right_extension_from_window_door: 0,
      right_distance_above_top_of_window: 0,
      right_distance_below_bottom_of_window: 0,
      right_tilt_angle_from_window_door: 90,
      right_depth: 0.3,
    }
    json['Shading:Fin'] = { Fin1: finRaw }
    const model = parseEpjson(json, 'x.epJSON')
    const left = model.surfaces.find((s) => s.name === 'Fin1 Left')!
    const right = model.surfaces.find((s) => s.name === 'Fin1 Right')!
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    // Neither name is a key in the source epJSON; both surfaces point at the
    // exact same raw object rather than a copy.
    expect(left.raw).toBe(right.raw)
    expect(left.raw).toBe(finRaw)
    expect(left.hostSurface).toBe('Win1')
    expect(right.hostSurface).toBe('Win1')
  })

  it('computes a Shading:Fin:Projection depth as a fraction of the window width', () => {
    const json = withWindow() // window width = 2m
    json['Shading:Fin:Projection'] = {
      Fin1: {
        window_or_door_name: 'Win1',
        left_extension_from_window_door: 0,
        left_distance_above_top_of_window: 0,
        left_distance_below_bottom_of_window: 0,
        left_tilt_angle_from_window_door: 90,
        left_depth_as_fraction_of_window_door_width: 0.5,
        right_extension_from_window_door: 0,
        right_distance_above_top_of_window: 0,
        right_distance_below_bottom_of_window: 0,
        right_tilt_angle_from_window_door: 90,
        right_depth_as_fraction_of_window_door_width: 0,
      },
    }
    const model = parseEpjson(json, 'x.epJSON')
    const left = model.surfaces.find((s) => s.name === 'Fin1 Left')!
    // depth = 0.5 * window width (2m) = 1m; area = depth * window height (1m)
    expect(left.area).toBeCloseTo(1 * 1)
    expect(model.surfaces.find((s) => s.name === 'Fin1 Right')).toBeUndefined()
  })
})
