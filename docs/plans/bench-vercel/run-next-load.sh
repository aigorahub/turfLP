set -u
SP=/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/a8a8e6ad-474f-4865-ac8b-d2ea07503364/scratchpad
R=/Users/john/aigora/dev/turfLP
U=https://turflp-bench-awuscbtva-aigora-ai.vercel.app
S=https://turflp-bench-efsyp8q72-aigora-ai.vercel.app
cd $SP/bench-next
export BYPASS=$(vercel curl /api/turf --deployment $U --debug -- -s -o /dev/null 2>&1 | grep -o 'project settings: [A-Za-z0-9_-]*' | awk '{print $3}')
export DEPLOYMENT=dpl_1PSf9DqQLZkJiPxdc7k7jfpXt5Nf
export INPUT=$R/conformance/inputs/gen-bench-200x20.json FIXTURE=$R/conformance/fixtures/turf.json
node $SP/check-next.mjs $U $S
for rep in 1 2; do for c in 1 2 4 8; do node $SP/load-next.mjs $U $c 40; done; done
echo done
