/** Version adaptation affects only the viewer's working document, never downloads. */
type Obj = Record<string, unknown>
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const entries = (root: Obj, type: string): [string, Obj][] => Object.entries(object(root[type])).map(([name, value]) => [name, object(value)])
const families = new Set(['8.9', '9.0', '9.1', '9.2', '9.3', '9.4', '9.5', '9.6', '22.1', '22.2', '23.1', '23.2', '24.1', '24.2', '25.1', '25.2', '26.1', '26.2'])

export function adaptGeometry(root: Obj, warn: (message: string) => void): Obj {
  const versions = entries(root, 'Version')
  const version = String(versions[0]?.[1].version_identifier ?? '')
  const parts = version.split('.')
  if (versions.length !== 1 || !/^\d+\.\d+(?:\.\d+)?$/.test(version) || !families.has(parts.slice(0, 2).join('.')) ||
      (parts[2] !== undefined && parts[2] !== '0' && version !== '9.0.1')) {
    warn(`EnergyPlus version ${version || '(unspecified)'} has not been verified; geometry is loaded leniently.`)
  }
  // The consumed coordinate fields share the same semantics across these
  // releases. Space membership (9.6+) and construction inheritance (26.2) are
  // resolved before the existing transforms, winding, and recentering run.
  const spaces = new Map(entries(root, 'Space').map(([name, value]) => [name.toLowerCase(), value]))
  const zones = new Map(entries(root, 'Zone').map(([name]) => [name.toLowerCase(), name]))
  let adapted = root
  const assign = (type: string, name: string, value: Obj): void => {
    if (adapted === root) adapted = { ...root }
    if (adapted[type] === root[type]) adapted[type] = { ...object(root[type]) }
    object(adapted[type])[name] = value
  }
  const surfaces: { type: string; name: string; value: Obj; sub: boolean }[] = []
  for (const type of Object.keys(root)) {
    if (!/^(BuildingSurface:Detailed|Wall:(Detailed|Exterior|Adiabatic|Underground|Interzone)|Roof|RoofCeiling:Detailed|Ceiling:(Adiabatic|Interzone)|Floor:(Detailed|GroundContact|Adiabatic|Interzone)|FenestrationSurface:Detailed|Window(?::Interzone)?|Door(?::Interzone)?|GlazedDoor(?::Interzone)?)$/.test(type)) continue
    for (const [name, original] of entries(root, type)) {
      let value = original
      const zone = text(original.zone_name) || text(spaces.get(text(original.space_name).toLowerCase())?.zone_name)
      const canonical = zones.get(zone.toLowerCase())
      if (canonical && canonical !== original.zone_name) {
        value = { ...original, zone_name: canonical }
        assign(type, name, value)
      }
      surfaces.push({ type, name, value, sub: /^(Fenestration|Window|Door|GlazedDoor)/.test(type) })
    }
  }
  if (!entries(root, 'ConstructionAssignmentSet').length) return adapted
  const lookup = (type: string): Map<string, Obj> => new Map(entries(root, type).map(([name, value]) => [name.toLowerCase(), value]))
  const sets = lookup('ConstructionAssignmentSet'), opaque = lookup('SurfaceConstructionAssignments'), glazing = lookup('SubSurfaceConstructionAssignments')
  const building = entries(root, 'Building')[0]?.[1]
  const buildingSet = sets.get(text(building?.construction_assignment_set_name).toLowerCase())
  const byName = new Map(surfaces.map((surface) => [surface.name.toLowerCase(), surface]))
  const air = new Set(entries(root, 'Construction:AirBoundary').map(([name]) => name.toLowerCase()))
  const constructionNames = new Map(Object.keys(root).filter((type) => /^Construction(?::|$)/.test(type))
    .flatMap((type) => entries(root, type)).map(([name]) => [name.toLowerCase(), name]))
  const layers = new Map(entries(root, 'Construction').map(([name, value]) => [name, Object.entries(value)
    .filter(([field]) => field === 'outside_layer' || /^layer_\d+$/.test(field))
    .sort(([a], [b]) => (a === 'outside_layer' ? 1 : Number(a.slice(6))) - (b === 'outside_layer' ? 1 : Number(b.slice(6))))
    .map(([, material]) => text(material).toLowerCase())]))
  const resolved = new Map<string, { construction: string; rank: number }>()
  const subFields: Record<string, string> = {
    window: 'fixed_window', fixedwindow: 'fixed_window', operablewindow: 'operable_window', skylight: 'skylight',
    door: 'door', glassdoor: 'glass_door', glazeddoor: 'glass_door', overheaddoor: 'overhead_door',
    tubulardaylightdome: 'tubular_daylight_dome', tubulardaylightdiffuser: 'tubular_daylight_diffuser',
  }
  for (const surface of surfaces) {
    const { value, sub, type, name } = surface
    const explicit = text(value.construction_name)
    if (explicit) {
      resolved.set(name.toLowerCase(), { construction: constructionNames.get(explicit.toLowerCase()) ?? explicit, rank: 0 })
      continue
    }
    const base = sub ? byName.get(text(value.building_surface_name).toLowerCase()) : surface
    const space = spaces.get(text(base?.value.space_name).toLowerCase())
    const bc = text(base?.value.outside_boundary_condition).toLowerCase() || (/Interzone/.test(base?.type ?? '') ? 'surface' : /Adiabatic/.test(base?.type ?? '') ? 'adiabatic' : /Underground|GroundContact/.test(base?.type ?? '') ? 'ground' : 'outdoors')
    const exterior = /^(outdoors|othersidecoefficients)$/.test(bc)
    const surfaceType = (text(value.surface_type) || type.split(':')[0]!).toLowerCase()
    for (const [rank, set] of [[1, sets.get(text(space?.construction_assignment_set_name).toLowerCase())], [2, buildingSet]] as const) {
      if (!set) continue
      let construction = ''
      if (!sub && (bc === 'adiabatic' || text(value.outside_boundary_condition_object).toLowerCase() === name.toLowerCase())) {
        construction = text(set.adiabatic_surface_construction_name)
      } else {
        const category = exterior ? 'exterior' : !sub && /^(ground|foundation)/.test(bc) ? 'ground_contact' : 'interior'
        const group = (sub ? glazing : opaque).get(text(set[`${category}_${sub ? 'subsurface' : 'surface'}_construction_assignments_name`]).toLowerCase())
        const slot = sub ? subFields[surfaceType] : surfaceType === 'floor' ? 'floor' : /roof|ceiling/.test(surfaceType) ? 'roof_ceiling' : 'wall'
        construction = slot ? text(group?.[`${slot}_construction_name`]) : ''
      }
      const canonical = constructionNames.get(construction.toLowerCase())
      if (canonical) { resolved.set(name.toLowerCase(), { construction: canonical, rank }); break }
    }
  }
  // Matching interzone surfaces choose the nearer assignment. A reversed
  // construction is internal viewer metadata, just as it is generated by E+.
  const reverse = (name: string): string => {
    if (air.has(name.toLowerCase())) return name
    const originalLayers = layers.get(name)
    if (!originalLayers?.length) return name
    const reversed = [...originalLayers].reverse()
    for (const [candidate, values] of layers) if (JSON.stringify(values) === JSON.stringify(reversed)) return candidate
    let generated = `Reverse of ${name}`
    while (constructionNames.has(generated.toLowerCase())) generated += ' (viewer)'
    layers.set(generated, reversed)
    constructionNames.set(generated.toLowerCase(), generated)
    return generated
  }
  for (const surface of surfaces) {
    const own = resolved.get(surface.name.toLowerCase())
    const adjacentName = text(surface.value.outside_boundary_condition_object)
    const adjacent = /^(surface)$/i.test(text(surface.value.outside_boundary_condition)) || surface.sub
      ? resolved.get(adjacentName.toLowerCase()) : undefined
    let construction = own?.construction
    if (adjacent && (!own || adjacent.rank < own.rank)) {
      const ownLayers = construction ? layers.get(construction) : undefined
      const otherLayers = layers.get(adjacent.construction)
      if (!ownLayers || !otherLayers || JSON.stringify(ownLayers) !== JSON.stringify([...otherLayers].reverse())) construction = reverse(adjacent.construction)
    }
    if (construction && construction !== surface.value.construction_name) assign(surface.type, surface.name, { ...surface.value, construction_name: construction })
    else if (!construction) warn(`${surface.name}: construction assignment could not be resolved.`)
  }
  return adapted
}
