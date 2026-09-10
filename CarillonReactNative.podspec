require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Where the Swift SDK comes from.
#
# By URL, which is what a customer's `pod install` resolves, unless a checkout
# is named — which is what development does while carillon-swift is unpublished.
# Both produce the same `import Carillon`, so nothing else in this package
# knows which one it got. The path has to be absolute: CocoaPods records it in
# the Pods project, whose directory is not the one this is read from.
carillon_swift = ENV["CARILLON_SWIFT_PATH"].to_s

Pod::Spec.new do |s|
  # Not "Carillon": the pod's name becomes its module name, and a module named
  # Carillon inside a package that imports the Swift module Carillon is an
  # ambiguity with no way to spell your way out of it. The name JavaScript asks
  # for is the Objective-C class's, and that one is `Carillon`.
  s.name         = "CarillonReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/exostack/carillon-react-native.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  # No public headers at all, deliberately: the only header here imports the
  # generated C++ spec, and an umbrella that exposed it would put C++ in front
  # of the Swift compiler — and the Objective-C class `Carillon` in front of
  # `import Carillon`.
  s.private_header_files = "ios/**/*.h"

  install_modules_dependencies(s)

  if carillon_swift.empty?
    spm_dependency(s,
      url: "https://github.com/exostack/carillon-swift.git",
      requirement: { kind: "upToNextMajorVersion", minimumVersion: "0.2.0" },
      products: ["Carillon"])
  else
    spm_dependency(s,
      url: File.expand_path(carillon_swift),
      requirement: {},
      products: ["Carillon"])
  end
end
