fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Make the build self-contained: no system `protoc` required.
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path()?);

    let proto = "../../proto/topology.proto";
    let include = "../../proto";
    println!("cargo:rerun-if-changed={proto}");
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(&[proto], &[include])?;
    Ok(())
}
