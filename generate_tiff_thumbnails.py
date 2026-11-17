2026-11-17T17:16:45.163Z [INFO]: # Build environment configured with Standard build compute type: 8GiB Memory, 4vCPUs, 128GB Disk Space
2026-11-17T17:16:45.744Z [INFO]: # Cloning repository: git@github.com:erodriguezICP/AWS-image-viewer.git
2026-11-17T17:16:46.508Z [INFO]: 
2026-11-17T17:16:46.508Z [INFO]: Cloning into 'AWS-image-viewer'...
2026-11-17T17:16:46.508Z [INFO]: # Switching to commit: eecf22d64d6360eb5b53ed310d7eb83b33874a99
2026-11-17T17:16:46.520Z [INFO]: Note: switching to 'eecf22d64d6360eb5b53ed310d7eb83b33874a99'.
                                 You are in 'detached HEAD' state. You can look around, make experimental
                                 changes and commit them, and you can discard any commits you make in this
                                 state without impacting any branches by switching back to a branch.
                                 If you want to create a new branch to retain commits you create, you may
                                 do so (now or later) by using -c with the switch command. Example:
                                 git switch -c <new-branch-name>
                                 Or undo this operation with:
                                 git switch -
                                 Turn off this advice by setting config variable advice.detachedHead to false
                                 HEAD is now at eecf22d Fix thumbnail viewport and image handling
2026-11-17T17:16:46.559Z [INFO]: Successfully cleaned up Git credentials
2026-11-17T17:16:46.560Z [INFO]: # Checking for Git submodules at: /codebuild/output/src2263258958/src/AWS-image-viewer/.gitmodules
2026-11-17T17:16:46.566Z [INFO]: # Retrieving environment cache...
2026-11-17T17:16:46.626Z [INFO]: # Retrieved environment cache
2026-11-17T17:16:46.627Z [INFO]: ---- Setting Up SSM Secrets ----
2026-11-17T17:16:46.627Z [INFO]: SSM params {"Path":"/amplify/d5dhf85n51vh1/main/","WithDecryption":true}
2026-11-17T17:16:47.387Z [INFO]: # No package override configuration found.
2026-11-17T17:16:47.390Z [INFO]: # Retrieving cache...
2026-11-17T17:17:07.359Z [INFO]: # Extracting cache...
2026-11-17T17:17:27.178Z [INFO]: # Extraction completed
2026-11-17T17:17:27.382Z [INFO]: # Retrieved cache
2026-11-17T17:17:31.257Z [INFO]: ## Starting Backend Build
                                 # Starting phase: build
                                 # Executing command: npm ci --cache .npm --prefer-offline
2026-11-17T17:17:47.786Z [WARNING]: npm warn ERESOLVE overriding peer dependency
2026-11-17T17:17:47.789Z [WARNING]: npm warn While resolving: @aws-amplify/plugin-types@1.10.1
                                    npm warn Found: @aws-sdk/types@3.821.0
                                    npm warn node_modules/@aws-amplify/data-construct/node_modules/@aws-amplify/ai-constructs/node_modules/@aws-amplify/plugin-types/node_modules/@aws-sdk/types
                                    npm warn
                                    npm warn Could not resolve dependency:
                                    npm warn peer @aws-sdk/types@"^3.734.0" from @aws-amplify/plugin-types@1.10.1
                                    npm warn node_modules/@aws-amplify/data-construct/node_modules/@aws-amplify/ai-constructs/node_modules/@aws-amplify/plugin-types
                                    npm warn   @aws-amplify/plugin-types@"^1.10.1" from @aws-amplify/ai-constructs@1.5.3
                                    npm warn   node_modules/@aws-amplify/data-construct/node_modules/@aws-amplify/ai-constructs
2026-11-17T17:17:47.857Z [WARNING]: npm warn ERESOLVE overriding peer dependency
2026-11-17T17:17:47.858Z [WARNING]: npm warn While resolving: @aws-amplify/plugin-types@1.10.1
                                    npm warn Found: @aws-sdk/types@3.821.0
                                    npm warn node_modules/@aws-amplify/graphql-api-construct/node_modules/@aws-amplify/ai-constructs/node_modules/@aws-amplify/plugin-types/node_modules/@aws-sdk/types
                                    npm warn
                                    npm warn Could not resolve dependency:
                                    npm warn peer @aws-sdk/types@"^3.734.0" from @aws-amplify/plugin-types@1.10.1
                                    npm warn node_modules/@aws-amplify/graphql-api-construct/node_modules/@aws-amplify/ai-constructs/node_modules/@aws-amplify/plugin-types
                                    npm warn   @aws-amplify/plugin-types@"^1.10.1" from @aws-amplify/ai-constructs@1.5.3
                                    npm warn   node_modules/@aws-amplify/graphql-api-construct/node_modules/@aws-amplify/ai-constructs
2026-11-17T17:18:06.102Z [WARNING]: npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
2026-11-17T17:18:06.152Z [WARNING]: npm warn deprecated @babel/plugin-proposal-class-properties@7.18.6: This proposal has been merged to the ECMAScript standard and thus this plugin is no longer maintained. Please use @babel/plugin-transform-class-properties instead.
2026-11-17T17:18:06.229Z [WARNING]: npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported
2026-11-17T17:18:06.325Z [WARNING]: npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
2026-11-17T17:18:06.336Z [WARNING]: npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
2026-11-17T17:18:06.395Z [WARNING]: npm warn deprecated @babel/plugin-proposal-object-rest-spread@7.20.7: This proposal has been merged to the ECMAScript standard and thus this plugin is no longer maintained. Please use @babel/plugin-transform-object-rest-spread instead.
2026-11-17T17:18:08.046Z [WARNING]: npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
2026-11-17T17:18:30.504Z [WARNING]: npm warn deprecated core-js@2.6.12: core-js@<3.23.3 is no longer maintained and not recommended for usage due to the number of issues. Because of the V8 engine whims, feature detection in old core-js versions could cause a slowdown up to 100x even if nothing is polyfilled. Some versions have web compatibility issues. Please, upgrade your dependencies to the actual version of core-js.
2026-11-17T17:18:33.703Z [INFO]: added 1695 packages, and audited 2557 packages in 57s
2026-11-17T17:18:33.707Z [INFO]: 228 packages are looking for funding
                                 run `npm fund` for details
2026-11-17T17:18:34.753Z [INFO]: 134 vulnerabilities (5 low, 62 moderate, 64 high, 3 critical)
                                 To address issues that do not require attention, run:
                                 npm audit fix
                                 To address all issues possible (including breaking changes), run:
                                 npm audit fix --force
                                 Some issues need review, and may require choosing
                                 a different dependency.
                                 Run `npm audit` for details.
2026-11-17T17:18:34.796Z [INFO]: # Executing command: npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
2026-11-17T17:18:38.004Z [INFO]: 5:18:37 PM Synthesizing backend...
2026-11-17T17:18:38.008Z [INFO]: 
2026-11-17T17:18:38.767Z [WARNING]: Bundling asset amplify-d5dhf85n51vh1-main-branch-294e250efe/AmplifyBranchLinker/CustomResourceLambda/Code/Stage...
2026-11-17T17:18:39.010Z [WARNING]: ...8857711afff8d5de58a2357e60771859f833564ddd203b-building/index.js  1.2mb ⚠️
                                    ⚡ Done in 65ms
2026-11-17T17:18:39.498Z [INFO]: 5:18:39 PM ✔ Backend synthesized in 2.02 seconds
2026-11-17T17:18:39.498Z [INFO]: 5:18:39 PM Running type checks...
2026-11-17T17:18:45.491Z [INFO]: 5:18:45 PM ✔ Type checks completed in 5.99 seconds
2026-11-17T17:18:45.501Z [INFO]: 5:18:45 PM Building and publishing assets...
2026-11-17T17:18:46.738Z [INFO]: 5:18:46 PM ✔ Built and published assets
2026-11-17T17:18:49.559Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   0 | 5:18:47 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | amplify-d5dhf85n51vh1-main-branch-294e250efe User Initiated
2026-11-17T17:18:53.816Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   0 | 5:18:51 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | archive-bucket-stack.NestedStack/archive-bucket-stack.NestedStackResource (archivebucketstack0173A853)
2026-11-17T17:18:53.820Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   0 | 5:18:51 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | auth.NestedStack/auth.NestedStackResource (auth179371D7)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe |   1 | 5:18:52 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | archive-bucket-stack.NestedStack/archive-bucket-stack.NestedStackResource (archivebucketstack0173A853)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe |   2 | 5:18:52 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | auth.NestedStack/auth.NestedStackResource (auth179371D7)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe |   2 | 5:18:53 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | data.NestedStack/data.NestedStackResource (data7552DF31)
2026-11-17T17:18:56.034Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   2 | 5:18:53 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O User Initiated
2026-11-17T17:19:02.597Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   2 | 5:19:00 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | data/amplifyData/AmplifyTableManager.NestedStack/AmplifyTableManager.NestedStackResource (amplifyDataAmplifyTableManagerNestedStackAmplifyTableManagerNestedStackResource86290833)
2026-11-17T17:19:02.601Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   2 | 5:19:00 PM | UPDATE_IN_PROGRESS | AWS::AppSync::ApiKey | data/amplifyData/GraphQLAPI/DefaultApiKey (amplifyDataGraphQLAPIDefaultApiKey1C8ED374)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   3 | 5:19:01 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | data/amplifyData/AmplifyTableManager.NestedStack/AmplifyTableManager.NestedStackResource (amplifyDataAmplifyTableManagerNestedStackAmplifyTableManagerNestedStackResource86290833)
2026-11-17T17:19:04.871Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   3 | 5:19:02 PM | UPDATE_IN_PROGRESS | AWS::CloudFormation::Stack | data/amplifyData/Todo.NestedStack/Todo.NestedStackResource (amplifyDataTodoNestedStackTodoNestedStackResource551CEA56)
2026-11-17T17:19:04.871Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   4 | 5:19:02 PM | UPDATE_COMPLETE | AWS::AppSync::ApiKey | data/amplifyData/GraphQLAPI/DefaultApiKey (amplifyDataGraphQLAPIDefaultApiKey1C8ED374)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   5 | 5:19:03 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | data/amplifyData/Todo.NestedStack/Todo.NestedStackResource (amplifyDataTodoNestedStackTodoNestedStackResource551CEA56)
2026-11-17T17:19:07.144Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   6 | 5:19:05 PM | UPDATE_COMPLETE_CLEANUP_IN_PROGRESS | AWS::CloudFormation::Stack | amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O
2026-11-17T17:19:16.218Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   7 | 5:19:15 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | data.NestedStack/data.NestedStackResource (data7552DF31)
2026-11-17T17:19:18.477Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   8 | 5:19:16 PM | UPDATE_COMPLETE_CLEANUP_IN_PROGRESS | AWS::CloudFormation::Stack | amplify-d5dhf85n51vh1-main-branch-294e250efe
2026-11-17T17:19:18.478Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   7 | 5:19:17 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | archive-bucket-stack.NestedStack/archive-bucket-stack.NestedStackResource (archivebucketstack0173A853)
2026-11-17T17:19:20.724Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   6 | 5:19:18 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | data/amplifyData/Todo.NestedStack/Todo.NestedStackResource (amplifyDataTodoNestedStackTodoNestedStackResource551CEA56)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   5 | 5:19:18 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | data/amplifyData/AmplifyTableManager.NestedStack/AmplifyTableManager.NestedStackResource (amplifyDataAmplifyTableManagerNestedStackAmplifyTableManagerNestedStackResource86290833)
2026-11-17T17:19:20.730Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O |   6 | 5:19:19 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | amplify-d5dhf85n51vh1-main-branch-294e250efe-data7552DF31-IS4H1K8YAL0O
2026-11-17T17:19:29.168Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   5 | 5:19:27 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | data.NestedStack/data.NestedStackResource (data7552DF31)
2026-11-17T17:19:29.172Z [INFO]: amplify-d5dhf85n51vh1-main-branch-294e250efe |   4 | 5:19:28 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | auth.NestedStack/auth.NestedStackResource (auth179371D7)
                                 amplify-d5dhf85n51vh1-main-branch-294e250efe |   5 | 5:19:28 PM | UPDATE_COMPLETE | AWS::CloudFormation::Stack | amplify-d5dhf85n51vh1-main-branch-294e250efe
2026-11-17T17:19:32.981Z [INFO]: 5:19:32 PM ✔ Deployment completed in 46.242 seconds
                                 5:19:32 PM AppSync API endpoint = https://7kswfkkm2rennobmi7gaehlpjq.appsync-api.us-east-1.amazonaws.com/graphql
2026-11-17T17:19:33.242Z [INFO]: 5:19:33 PM File written: amplify_outputs.json
2026-11-17T17:19:33.373Z [INFO]: Notices:
                                 3127	Amplify Function is dropping support of Node 16 Lambda Functions
                                 If you have Node 16 Lambda functions defined with Amplify Function, we highly
                                 recommend updating your function's runtime to newer Node LTS versions (Node 20+).
                                 More information at: https://github.com/aws-amplify/amplify-backend/issues/3127
                                 If you don't want to see a notice anymore, use npx ampx notices acknowledge <notice-id>
2026-11-17T17:19:33.578Z [INFO]: # Completed phase: build
                                 ## Completed Backend Build
2026-11-17T17:19:33.581Z [INFO]: ## Starting Frontend Build
2026-11-17T17:19:33.581Z [INFO]: # Starting phase: build
                                 # Executing command: npm run build
2026-11-17T17:19:33.684Z [INFO]: > amplify-vite-react-template@0.0.0 build
                                 > tsc && vite build
2026-11-17T17:19:35.867Z [INFO]: vite v7.3.1 building client environment for production...
2026-11-17T17:19:35.920Z [INFO]: transforming...
2026-11-17T17:19:38.766Z [INFO]: ✓ 2088 modules transformed.
2026-11-17T17:19:38.974Z [INFO]: rendering chunks...
2026-11-17T17:19:39.152Z [INFO]: computing gzip size...
2026-11-17T17:19:39.172Z [INFO]: dist/index.html                          0.46 kB │ gzip:   0.30 kB
2026-11-17T17:19:39.172Z [INFO]: dist/assets/index-7ByItrne.css         317.77 kB │ gzip:  31.11 kB
                                 dist/assets/index.browser-B4ZzwQJ4.js    4.85 kB │ gzip:   1.98 kB
                                 dist/assets/index-BjLeWhfa.js          814.36 kB │ gzip: 242.23 kB
2026-11-17T17:19:39.172Z [WARNING]: (!) Some chunks are larger than 500 kB after minification. Consider:
                                    - Using dynamic import() to code-split the application
                                    - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
                                    - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
2026-11-17T17:19:39.173Z [INFO]: ✓ built in 3.29s
2026-11-17T17:19:39.205Z [INFO]: # Completed phase: build
                                 ## Completed Frontend Build
2026-11-17T17:19:39.236Z [INFO]: ## Build completed successfully
2026-11-17T17:19:39.236Z [INFO]: # Starting caching...
2026-11-17T17:19:39.243Z [INFO]: # Creating cache artifact...
2026-11-17T17:19:54.058Z [INFO]: # Created cache artifact
2026-11-17T17:19:54.144Z [INFO]: # Uploading cache artifact...
2026-11-17T17:20:07.817Z [INFO]: # Uploaded cache artifact
2026-11-17T17:20:07.916Z [INFO]: # Caching completed
2026-11-17T17:20:07.948Z [INFO]: # Starting build artifact upload process...
2026-11-17T17:20:07.993Z [INFO]: # Uploading build artifact '__artifacts.zip'...
2026-11-17T17:20:08.123Z [INFO]: # Build artifact upload completed
2026-11-17T17:20:08.124Z [INFO]: # Starting environment caching...
2026-11-17T17:20:08.124Z [INFO]: # Uploading environment cache artifact...
2026-11-17T17:20:08.227Z [INFO]: # Uploaded environment cache artifact
2026-11-17T17:20:08.227Z [INFO]: # Environment caching completed

