#pragma once
#include "stream.hpp"
#include <memory>
#include <string>
namespace gsv {
// Offline compiled model only. Construct/load on a control or worker thread.
// compute: "cpu", "cpu-gpu", "all". ALL does not prove ANE execution.
std::unique_ptr<Estimator> coreMLP0(const std::string& compiledPath, const std::string& compute);
}
