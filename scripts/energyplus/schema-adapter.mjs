// Adapt only schema selection and its version check; parsing, validation, and
// output serialization remain the pinned upstream ConvertInputFormat code.
export function schemaAdapter(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Review upstream schema adapter: ${before}`)
    source = source.replace(before, after)
  }
  replace('bool checkVersionMatch(json const &epJSON)', 'std::string schemaVersion;\n\nbool checkVersionMatch(json const &epJSON)')
  source = source.replaceAll('EnergyPlus::DataStringGlobals::MatchVersion', 'schemaVersion')
  replace('    fs::path inputFilePath;', `    fs::path schemaPath;
    app.add_option("--schema", schemaPath, "Full matching epJSON schema")->required()->check(CLI::ExistingFile);
    fs::path inputFilePath;`)
  replace(`    auto const embeddedEpJSONSchema = EnergyPlus::EmbeddedEpJSONSchema::embeddedEpJSONSchema();
    auto schema = json::from_cbor(embeddedEpJSONSchema);`, `    auto schema = EnergyPlus::FileSystem::readJSON(schemaPath);
    auto const &patterns = schema.at("properties").at("Version").at("patternProperties");
    auto const &versionDefault = patterns.begin().value().at("properties").at("version_identifier").at("default");
    schemaVersion = versionDefault.is_string() ? versionDefault.get<std::string>() : versionDefault.dump();
    if (schemaVersion.empty() || schemaVersion.find('@') != std::string::npos) {
        displayMessage("Invalid schema version");
        return 1;
    }`)
  replace('    if (isEpJSON && !versionMatch) {', '    if (!versionMatch) {')
  return source
}

export function validationAdapter(source) {
  const before = 'valijson::SchemaParser parser;'
  if (source.split(before).length !== 2) throw new Error('Review upstream JSON Schema dialect selection')
  return source.replace(before, `valijson::SchemaParser parser(
            schema->at("$schema").get<std::string>().find("draft-04") != std::string::npos
                ? valijson::SchemaParser::kDraft4 : valijson::SchemaParser::kDraft7);`)
}
