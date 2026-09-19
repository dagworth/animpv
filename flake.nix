{
  description = "Dev environment for animpv (Electron app that scrapes anime and drives mpv)";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixpkgs-unstable/nixexprs.tar.zst";
  };

  outputs = inputs: {
    devShells = builtins.mapAttrs (system: _: let
      pkgs = import inputs.nixpkgs {
        inherit system;
        config.permittedInsecurePackages = [ "electron-39.8.10" ];
      };
    in {
      default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_22
          pkgs.electron_39
          pkgs.mpv
          pkgs.patchelf
        ];

        shellHook = ''
          export ELECTRON_SKIP_BINARY_DOWNLOAD=1
          export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron_39}/bin/"
          export ELECTRON_EXEC_PATH="${pkgs.electron_39}/bin/electron"
          export NIX_LD="${pkgs.stdenv.cc.bintools.dynamicLinker}"
          export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.glibc ]}"
        '';
      };
    }) inputs.nixpkgs.legacyPackages;
  };
}
