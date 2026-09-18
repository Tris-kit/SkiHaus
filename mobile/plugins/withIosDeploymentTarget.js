// Forces every CocoaPod to iOS 16.0 on prebuild.
//
// Xcode 15+ refuses anything below 12.0 and warns below 15.0, but plenty of
// transitive pods still declare 9.0 and the build fails on them. Patching the
// Podfile's post_install is the only hook that reaches every pod.
//
// Copied verbatim from Split, where it earned its place. Idempotent via the
// marker comment — `expo prebuild` runs this on a Podfile it may have already
// patched.

const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "min-ios-deployment-target";
const TARGET = "16.0";

const PATCH = `
  # ${MARKER}
  installer.pods_project.targets.each do |t|
    t.build_configurations.each do |config|
      current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      if current.nil? || current.to_f < ${TARGET}
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${TARGET}'
      end
    end
  end
`;

module.exports = function withIosDeploymentTarget(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfile)) return cfg;

      let contents = fs.readFileSync(podfile, "utf8");
      if (contents.includes(MARKER)) return cfg;

      // Append inside the existing post_install block rather than adding a
      // second one — CocoaPods only honours the last definition.
      const anchor = /post_install do \|installer\|/;
      if (!anchor.test(contents)) return cfg;

      contents = contents.replace(anchor, (m) => `${m}\n${PATCH}`);
      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);
};
