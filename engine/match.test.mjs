import { diagnose, extractFaultCodes } from "./match.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const knowledge = {
  components: JSON.parse(readFileSync(join(root, "data/components.json"), "utf8")),
  cases: JSON.parse(readFileSync(join(root, "data/cases.json"), "utf8")),
  documents: JSON.parse(readFileSync(join(root, "data/documents.json"), "utf8")),
};

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

assert(knowledge.components.length === 14, "14 components");
assert(knowledge.cases.length === 14, "one demo case per component");
assert(knowledge.documents.length === 14, "one doc placeholder per component");

const yaw = diagnose("偏航异响，报过偏航过载", knowledge);
assert(!yaw.empty, "yaw query has hits");
assert(yaw.hits.length >= 2 && yaw.hits.length <= 3, "yaw returns 2–3 hits");
assert(yaw.hits[0].caseId === "yaw-overload-noise", "yaw case ranks first");
assert(
  yaw.hits[0].reasons.some((r) => r.type === "keyword" || r.type === "component"),
  "yaw hit explains why"
);

const pitch = diagnose("变桨 1 轴跟不上", knowledge);
assert(pitch.hits[0].caseId === "pitch-desync", "pitch query ranks pitch case");

const code = diagnose("F1234", knowledge);
assert(code.empty, "unknown code is no-hit");

const knownCode = diagnose("F2101", knowledge);
assert(knownCode.hits[0].caseId === "pitch-desync", "exact fault code hits pitch");
assert(knownCode.hits[0].reasons.some((r) => r.type === "fault_code"), "code reason present");

const empty = diagnose("量子共振香蕉风暴", knowledge);
assert(empty.empty, "nonsense query is empty");

assert(extractFaultCodes("报 F6105 和 f2101").includes("F6105"), "extract codes");

const chip = diagnose("油温高", knowledge, { componentId: "gearbox" });
assert(chip.hits[0].caseId === "gearbox-oil-temp", "component chip weights gearbox");

const unknownWithChip = diagnose("F1234", knowledge, { componentId: "pitch" });
assert(unknownWithChip.empty, "unknown code stays empty even with a chip");

const chipOnly = diagnose("", knowledge, { componentId: "pitch" });
assert(!chipOnly.empty, "chip-only still lists the component case");
assert(chipOnly.hits[0].caseId === "pitch-desync", "chip-only ranks pitch case");

if (process.exitCode) {
  console.error("match tests failed");
  process.exit(1);
}
console.log("all match tests passed");
