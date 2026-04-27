with open('src/ui/public/modules.js', 'rb') as f:
    raw = f.read()

s = raw.find(b'  // Use a plain string (not template literal)')
sub = raw[s:]
ps_offset = sub.find(b'ps;')
e = s + ps_offset + len(b'ps;')

print('s=%d e=%d len=%d' % (s, e, e-s))

NEW = (
    b"  // bash + curl - Linux ADO agents (ubuntu-latest)\r\n"
    b"  // Fixed: jq JSON, QA_PLATFORM_URL from var group, curl --retry\r\n"
    b"  const sh = [\r\n"
    b'    "      set -euo pipefail",\r\n'
    b'    "      PLATFORM=\\"${QA_PLATFORM_URL}\\"",\r\n'
    b'    "      SUITE_ID=\'" + suiteIdVal + "\'",\r\n'
    b'    "      ENV_ID=\'"   + envId + "\'",\r\n'
    b'    "      TIMEOUT_SECS=$(( " + timeout + " * 60 ))",\r\n'
    b'    "      POLL_SECS=" + poll,\r\n'
    b'    "",\r\n'
    b'    "      command -v jq >/dev/null 2>&1 || { apt-get install -y jq >/dev/null 2>&1; }",\r\n'
    b'    "",\r\n'
    b'    "      echo \'Triggering suite: " + suiteName.replace(/\'/g, "") + "\'",\r\n'
    b'    "      RESPONSE=$(curl -sf --retry 3 --retry-delay 5 -X POST \\"${PLATFORM}/api/suites/${SUITE_ID}/run\\" \\\\",\r\n'
    b'    "        -H \\"Authorization: Bearer ${QA_API_KEY}\\" \\\\",\r\n'
    b'    "        -H \'Content-Type: application/json\' \\\\",\r\n'
    b'    "        -d \'{\\"environmentId\\":\\"\'"${ENV_ID}"\'\\"}\')",\r\n'
    b'    "",\r\n'
    b'    "      RUN_ID=$(echo \\"$RESPONSE\\" | jq -r \'.runId // empty\')",\r\n'
    b'    "      [ -z \\"$RUN_ID\\" ] && { echo \\"ERROR: No runId. Response: $RESPONSE\\"; exit 1; }",\r\n'
    b'    "      echo \\"Run ID: $RUN_ID\\"",\r\n'
    b'    "",\r\n'
    b'    "      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))",\r\n'
    b'    "      STATUS=running",\r\n'
    b'    "      while [ \\"$STATUS\\" = \'running\' ]; do",\r\n'
    b'    "        sleep \\"$POLL_SECS\\"",\r\n'
    b'    "        RUN=$(curl -sf --retry 3 --retry-delay 5 \\"${PLATFORM}/api/run/${RUN_ID}\\" \\\\",\r\n'
    b'    "          -H \\"Authorization: Bearer ${QA_API_KEY}\\")",\r\n'
    b'    "        STATUS=$(echo \\"$RUN\\" | jq -r \'.status // \\"unknown\\"\')",\r\n'
    b'    "        PASSED=$(echo \\"$RUN\\" | jq -r \'.passed // 0\')",\r\n'
    b'    "        FAILED=$(echo \\"$RUN\\" | jq -r \'.failed // 0\')",\r\n'
    b'    "        TOTAL=$( echo \\"$RUN\\" | jq -r \'.total  // 0\')",\r\n'
    b'    "        echo \\"[$STATUS] passed=${PASSED} failed=${FAILED} total=${TOTAL}\\"",\r\n'
    b'    "        if [ $(date +%s) -gt \\"$DEADLINE\\" ]; then",\r\n'
    b'    "          echo \'ERROR: Timed out after " + timeout + " min.\'",\r\n'
    b'    "          exit 1",\r\n'
    b'    "        fi",\r\n'
    b'    "      done",\r\n'
    b'    "",\r\n'
    b'    "      REPORT_URL=\\"${PLATFORM}/execution-report?runId=${RUN_ID}\\"",\r\n'
    b'    "      echo \\"Report: ${REPORT_URL}\\"",\r\n'
    b'    "",\r\n'
    b'    "      SUMMARY=\\"${AGENT_TEMPDIRECTORY}/qa-summary.md\\"",\r\n'
    b'    "      printf \'## TestForge Results\\\\n**Suite:** " + suiteName.replace(/\'/g, "") + "\\\\n\\\\n\' > \\"$SUMMARY\\"",\r\n'
    b'    "      printf \'| | |\\\\n|---|---|\\\\n\' >> \\"$SUMMARY\\"",\r\n'
    b'    "      printf \'| Status | %s |\\\\n\' \\"$STATUS\\"  >> \\"$SUMMARY\\"",\r\n'
    b'    "      printf \'| Passed | %s |\\\\n\' \\"$PASSED\\"  >> \\"$SUMMARY\\"",\r\n'
    b'    "      printf \'| Failed | %s |\\\\n\' \\"$FAILED\\"  >> \\"$SUMMARY\\"",\r\n'
    b'    "      printf \'| Total  | %s |\\\\n\' \\"$TOTAL\\"   >> \\"$SUMMARY\\"",\r\n'
    b'    "      printf \'\\\\n[Open Report](%s)\\\\n\' \\"$REPORT_URL\\" >> \\"$SUMMARY\\"",\r\n'
    b'    "      echo \\"##vso[task.uploadsummary]${SUMMARY}\\"",\r\n'
    b'    "",\r\n'
    b'    "      if [ \\"$STATUS\\" = \'failed\' ] || [ \\"${FAILED}\\" -gt 0 ]; then",\r\n'
    b'    "        echo \\"ERROR: Suite FAILED (${FAILED} test(s) failed).\\"",\r\n'
    b'    "        exit 1",\r\n'
    b'    "      fi",\r\n'
    b'    "      echo \'All tests passed.\'",\r\n'
    b"  ].join('\\n');\r\n"
    b"\r\n"
    b"  // Reusable ADO template content (second download button)\r\n"
    b"  const templateYaml =\r\n"
    b'"# testforge-run-template.yml\\n"\r\n'
    b'"# Drop in your repo root. Reference from any pipeline via:\\n"\r\n'
    b'"#   - template: testforge-run-template.yml\\n"\r\n'
    b'"#     parameters:\\n"\r\n'
    b'"#       suiteName: My Suite\\n"\r\n'
    b'"#       suiteId: <id>\\n"\r\n'
    b'"#       envId: <env>\\n"\r\n'
    b'"# Variable Group \'qa-platform-config\' must have:\\n"\r\n'
    b'"#   QA_API_KEY      - secret, from TestForge Admin > API Keys\\n"\r\n'
    b'"#   QA_PLATFORM_URL - e.g. http://qa-launchpad-test:3000\\n"\r\n'
    b'"\\n"\r\n'
    b'"parameters:\\n"\r\n'
    b'"  - name: suiteName\\n"\r\n'
    b'"    type: string\\n"\r\n'
    b'"  - name: suiteId\\n"\r\n'
    b'"    type: string\\n"\r\n'
    b'"  - name: envId\\n"\r\n'
    b'"    type: string\\n"\r\n'
    b'"  - name: timeoutMinutes\\n"\r\n'
    b'"    type: number\\n"\r\n'
    b'"    default: 30\\n"\r\n'
    b'"  - name: pollSeconds\\n"\r\n'
    b'"    type: number\\n"\r\n'
    b'"    default: 5\\n"\r\n'
    b'"\\n"\r\n'
    b'"steps:\\n"\r\n'
    b'"- task: Bash@3\\n"\r\n'
    b'"  displayName: \'TestForge \\u2014 ${{ parameters.suiteName }}\'\\n"\r\n'
    b'"  env:\\n"\r\n'
    b'"    QA_API_KEY:      $(QA_API_KEY)\\n"\r\n'
    b'"    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\\n"\r\n'
    b'"  inputs:\\n"\r\n'
    b'"    targetType: inline\\n"\r\n'
    b'"    script: |\\n"\r\n'
    b'"      set -euo pipefail\\n"\r\n'
    b'"      PLATFORM=\\"${QA_PLATFORM_URL}\\"\\n"\r\n'
    b'"      SUITE_ID=\'${{ parameters.suiteId }}\'\\n"\r\n'
    b'"      ENV_ID=\'${{ parameters.envId }}\'\\n"\r\n'
    b'"      TIMEOUT_SECS=$(( ${{ parameters.timeoutMinutes }} * 60 ))\\n"\r\n'
    b'"      POLL_SECS=${{ parameters.pollSeconds }}\\n"\r\n'
    b'"      command -v jq >/dev/null 2>&1 || { apt-get install -y jq >/dev/null 2>&1; }\\n"\r\n'
    b'"      echo \'Triggering: ${{ parameters.suiteName }}\'\\n"\r\n'
    b'"      RESPONSE=$(curl -sf --retry 3 --retry-delay 5 -X POST \\"${PLATFORM}/api/suites/${SUITE_ID}/run\\" \\\\\\n"\r\n'
    b'"        -H \\"Authorization: Bearer ${QA_API_KEY}\\" \\\\\\n"\r\n'
    b'"        -H \'Content-Type: application/json\' \\\\\\n"\r\n'
    b'"        -d \'{\\"environmentId\\":\\"\'"\'${{ parameters.envId }}\'"\'\\"}\')\n"\r\n'
    b'"      RUN_ID=$(echo \\"$RESPONSE\\" | jq -r \'.runId // empty\')\\n"\r\n'
    b'"      [ -z \\"$RUN_ID\\" ] && { echo \\"ERROR: No runId\\"; exit 1; }\\n"\r\n'
    b'"      echo \\"Run ID: $RUN_ID\\"\\n"\r\n'
    b'"      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))\\n"\r\n'
    b'"      STATUS=running\\n"\r\n'
    b'"      while [ \\"$STATUS\\" = \'running\' ]; do\\n"\r\n'
    b'"        sleep \\"$POLL_SECS\\"\\n"\r\n'
    b'"        RUN=$(curl -sf --retry 3 --retry-delay 5 \\"${PLATFORM}/api/run/${RUN_ID}\\" \\\\\\n"\r\n'
    b'"          -H \\"Authorization: Bearer ${QA_API_KEY}\\")\\n"\r\n'
    b'"        STATUS=$(echo \\"$RUN\\" | jq -r \'.status // \\"unknown\\"\\')\\n"\r\n'
    b'"        PASSED=$(echo \\"$RUN\\" | jq -r \'.passed // 0\')\\n"\r\n'
    b'"        FAILED=$(echo \\"$RUN\\" | jq -r \'.failed // 0\')\\n"\r\n'
    b'"        TOTAL=$( echo \\"$RUN\\" | jq -r \'.total  // 0\')\\n"\r\n'
    b'"        echo \\"[$STATUS] passed=${PASSED} failed=${FAILED} total=${TOTAL}\\"\\n"\r\n'
    b'"        [ $(date +%s) -gt \\"$DEADLINE\\" ] && { echo \'Timed out.\'; exit 1; }\\n"\r\n'
    b'"      done\\n"\r\n'
    b'"      if [ \\"$STATUS\\" = \'failed\' ] || [ \\"${FAILED}\\" -gt 0 ]; then\\n"\r\n'
    b'"        echo \\"ERROR: FAILED (${FAILED} test(s) failed).\\"; exit 1\\n"\r\n'
    b'"      fi\\n"\r\n'
    b'"      echo \'All tests passed.\'\\n";\r\n'
    b"\r\n"
    b"  const yaml =\r\n"
    b'"# Generated by TestForge \\u2014 " + new Date().toISOString().slice(0,10) + "\\n" +\r\n'
    b'"# Inline pipeline step. For reuse across suites, download testforge-run-template.yml.\\n" +\r\n'
    b'"# Variable Group \'qa-platform-config\' must contain:\\n" +\r\n'
    b'"#   QA_API_KEY:      (secret) API key from TestForge Admin > API Keys\\n" +\r\n'
    b'"#   QA_PLATFORM_URL: http://qa-launchpad-test:3000\\n" +\r\n'
    b'(_apikeyRawKey ? "# QA_API_KEY value: " + rawKey + "\\n" : "") +\r\n'
    b'"\\n" +\r\n'
    b'"variables:\\n" +\r\n'
    b'"  - group: qa-platform-config\\n" +\r\n'
    b'"\\n" +\r\n'
    b'"- task: Bash@3\\n" +\r\n'
    b'"  displayName: \'TestForge Suite \\u2014 " + suiteName.replace(/\'/g, "\'\'") + "\'\\n" +\r\n'
    b'"  env:\\n" +\r\n'
    b'"    QA_API_KEY:      $(QA_API_KEY)\\n" +\r\n'
    b'"    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\\n" +\r\n'
    b'"  inputs:\\n" +\r\n'
    b'"    targetType: inline\\n" +\r\n'
    b'"    script: |\\n" +\r\n'
    b'sh;\r\n'
)

raw2 = raw[:s] + NEW + raw[e:]

with open('src/ui/public/modules.js', 'wb') as f:
    f.write(raw2)

print('Written OK — new size:', len(raw2))
print('PowerShell   :', raw2.find(b'PowerShell'))
print('Bash@3       :', b'Bash@3' in raw2)
print('jq -r        :', b'jq -r' in raw2)
print('--retry 3    :', b'--retry 3' in raw2)
print('templateYaml :', b'templateYaml' in raw2)
print('qa-launchpad :', b'qa-launchpad-test' in raw2)
