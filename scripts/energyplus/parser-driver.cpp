// Thin native/WASM driver for matching-release upstream parsers.
// All object interpretation and validation is performed by EnergyPlus.
#include <InputProcessing/IdfParser.hh>
#include <InputProcessing/InputValidation.hh>
#include <fstream>
#include <iostream>
#include <iterator>

void clean(nlohmann::json &value)
{
    if (!value.is_object()) return;
    value.erase("idf_order");
    value.erase("idf_max_fields");
    value.erase("idf_max_extensible_fields");
    for (auto it = value.begin(); it != value.end(); ++it) clean(it.value());
}

int main(int argc, char **argv)
{
    if (argc != 4) return 2;
    std::ifstream schemaFile(argv[1]), inputFile(argv[2]);
    nlohmann::json schema;
    schemaFile >> schema;
    std::string input((std::istreambuf_iterator<char>(inputFile)), {});
    IdfParser parser;
    bool success = true;
    auto output = parser.decode(input, schema, success);
    if (output.count("Version") != 1 || output["Version"].size() != 1) return 1;
    auto const &patterns = schema["properties"]["Version"]["patternProperties"];
    auto const &expected = patterns.begin().value()["properties"]["version_identifier"]["default"];
    const std::string expectedVersion = expected.is_string() ? expected.get<std::string>() : expected.dump();
    const std::string inputVersion = output["Version"].begin().value()["version_identifier"].get<std::string>();
    const auto secondDot = inputVersion.find('.', inputVersion.find('.') + 1);
    if (inputVersion.substr(0, secondDot) != expectedVersion) {
        std::cerr << "Input Version does not match the selected schema\n";
        return 1;
    }
    clean(output);
    Validation validation(&schema);
    const bool valid = validation.validate(output);
    for (auto const &message : parser.errors()) std::cerr << message << '\n';
    for (auto const &message : validation.errors()) std::cerr << message << '\n';
    if (!success || parser.hasErrors() || !valid) return 1;
    std::ofstream(argv[3]) << output.dump(4) << '\n';
}
