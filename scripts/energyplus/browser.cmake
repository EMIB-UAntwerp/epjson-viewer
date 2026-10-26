# Included after upstream targets have been defined. Conversion logic remains upstream.
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "The browser runtime must be built with Emscripten")
endif()

# Newer Clang versions diagnose upstream code differently. Keep warnings visible.
target_compile_options(project_options INTERFACE -Wno-error)
# fmt 8's consteval checks are incompatible with the pinned Clang; runtime
# formatting is unchanged. Apply consistently to fmt and its consumers.
target_compile_definitions(project_options INTERFACE FMT_CONSTEVAL=)

# The schema generator runs at build time in Node and needs the host filesystem.
if(TARGET generate_embeddable_epJSON_schema)
  # This repository is an ES-module package; the build-time helper uses require.
  set_target_properties(generate_embeddable_epJSON_schema PROPERTIES SUFFIX ".cjs")
  target_link_options(generate_embeddable_epJSON_schema PRIVATE
    "-sNODERAWFS=1" "-sMODULARIZE=0" "-sINVOKE_RUN=1"
    "-sALLOW_MEMORY_GROWTH=1")
endif()

set(browser_converters energyplus ConvertInputFormat)
if(SCHEMA_CONVERTER_SOURCE)
  get_filename_component(schema_adapter_dir "${SCHEMA_CONVERTER_SOURCE}" DIRECTORY)
  add_executable(SchemaConvertInputFormat "${SCHEMA_CONVERTER_SOURCE}" "${schema_adapter_dir}/SchemaValidation.cpp")
  target_link_libraries(SchemaConvertInputFormat PRIVATE energyplusparser project_options project_warnings)
  list(APPEND browser_converters SchemaConvertInputFormat)
endif()

foreach(converter IN LISTS browser_converters)
  set_target_properties(${converter} PROPERTIES
    OUTPUT_NAME "${converter}" SUFFIX ".mjs" VERSION ""
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/browser")
  target_link_options(${converter} PRIVATE
    -fwasm-exceptions
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createEnergyPlus"
    "-sENVIRONMENT=worker,node"
    "-sINVOKE_RUN=0"
    "-sEXIT_RUNTIME=0"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMAXIMUM_MEMORY=2147483648"
    "-sSTACK_SIZE=5242880"
    "-sFORCE_FILESYSTEM=1"
    "-sEXPORTED_RUNTIME_METHODS=['FS','callMain']")
endforeach()
