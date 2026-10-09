# Jobs Scout

A personal macOS company discovery app built with **Electron + React + TypeScript**. Define company interests and preferred roles in a JSON file, enter a GLM API key for each search, and receive company names, descriptions, matching reasons, website links, and dated reported valuations or market caps. The interface and generated descriptions use English.

## Run locally

Requires Node.js 22.12+ and npm. Node.js 24 LTS is recommended.

```sh
npm install
npm run dev
```

This opens a desktop window. A browser preview cannot read local files or call GLM.

## Use the app

1. The app starts with a local, editable `scout.json` seeded from the example. Click **Edit** in the preference card, change the JSON, and click **Save changes**. You can also choose **Import preferences** to use an existing file, or **Save example copy** to start a separate file.
2. Enter a **standard Zhipu AI API key** for this search. The default model is `glm-5.3-flash`; you can choose another model available to your account. Choose **Per category** (1–100) for this search. The default target is 100 companies for each interest, so two interests target 200 category matches. Its initial value comes from `companiesPerCategory` in the selected file. Changing the search count does not rewrite the file. Web search is enabled by default.
3. Click **Find companies**. Each search rereads the selected file. Filter the resulting shortlist by interest, company name, or description, sort by reported value (high to low or low to high) or best match, and copy company names when useful. Unknown values remain last in either value sort.

Your key is cleared as soon as you submit a search. It remains in memory only while the request is being handled and is never saved to the preference file, disk, logs, or localStorage. Enter it again for each search. Results are not retained after closing the app. The default file is stored in the app’s local user-data folder, so edits survive restarts. Imported files are edited in place; after restarting, import them again if you want to use them instead of the default file.

**Preview example results** displays clearly labeled fictional companies and values. It makes no network request or AI call and incurs no API fees.

## Preference file

```json
{
  "name": "My next chapter",
  "interests": ["AI + finance", "AI + healthcare"],
  "roles": ["Software Engineer", "AI Engineer"],
  "locations": ["San Francisco", "Remote"],
  "companyStage": "Seed to Series B",
  "notes": "Prioritize companies applying AI to real business problems.",
  "companiesPerCategory": 100
}
```

Only `interests` is required. Different interests are matched with OR; a `+` within an interest describes an intersection of fields. These preferences guide the model rather than applying strict database filters. `roles` describes roles you want to explore. An empty `locations` array means any location. `companyStage` and `notes` may be empty. `companiesPerCategory` defaults to 100 and accepts integers from 1 to 100 **per interest category**. Legacy files with the retired `maxResults` total cap still load; that field is ignored, and the new per-category target defaults to 100. Replace it with `companiesPerCategory` when editing the file.

Files must be UTF-8 JSON, no larger than 64 KB. Unknown fields are rejected. Do not put API keys in the file. Use the built-in JSON editor to save directly to the selected file. Invalid JSON and unknown fields are rejected before writing. If the file changes in an external editor, saving is blocked until you reopen the editor, so those changes are not overwritten. After editing externally, click **Reload preferences** to refresh the preview; searches also read the latest file automatically. User-authored preferences are preserved as written, while GLM is instructed to write recommendation details in English.

## GLM integration and result quality

The Electron main process sends requests directly to `https://open.bigmodel.cn/api/paas/v4/chat/completions`; there is no app server. With web search enabled, it first calls `https://open.bigmodel.cn/api/paas/v4/web_search` for each discovery batch, then passes the retrieved sources into the model request. Your company and role preferences are sent to Zhipu AI. Web search uses the documented basic `search_std` engine. Each lookup has a 10-second limit. Each category is collected in batches of up to 20 companies, with two categories processed concurrently. Later batches use varied queries and explicitly exclude already collected names. Category quotas are enforced after deduplication, and a company matching multiple interests appears once with all category memberships. The app stops a category after two batches add no companies, or after a bounded number of batches. Fewer than 100 genuine matches may be returned. Failed lookups keep successful sources; when retrieval is unavailable, the model can still generate a catalog from existing knowledge. The result explicitly indicates whether web sources were actually used. Error notices show the failing stage, HTTP status, and a sanitized provider error code, without exposing provider messages or credentials. Model calls and web search may incur fees. This release supports the standard mainland Zhipu AI endpoint; international Z.AI and Coding Plan-specific endpoints are not supported.

The default model uses the official [GLM-5.3-Flash model code](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash): `glm-5.3-flash`. Its request enables thinking, uses the supported `reasoning_effort: low` for this lightweight search task, and follows the recommended sampling defaults. The Flash API schema lists function tools and does not list the text-model-only `response_format` field, so Flash uses standalone search retrieval and a JSON output instruction instead. Other supported text models use the same retrieval pipeline and retain JSON mode.

The integration follows the official [Chat Completions reference](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8) and [Web Search API reference](https://docs.bigmodel.cn/api-reference/%E5%B7%A5%E5%85%B7-api/%E7%BD%91%E7%BB%9C%E6%90%9C%E7%B4%A2). Standalone queries stay within the documented 70-character limit; full preferences are always passed to the model. The app requests JSON, parses and deduplicates the results, limits their count, and filters invalid links. Authentication, access, rate limits, network errors, invalid JSON, truncated responses, and empty results have English messages. Searches can be cancelled and have a 20-minute overall limit, with individual discovery model calls limited to 90 seconds. Results and category counts appear as batches finish. Cancelling preserves already collected companies in the window, and a later category failure or overall timeout preserves a partial catalog. Cards are shown 60 at a time to keep large catalogs responsive; filtering, sorting, and copying operate on the complete collected list. Paid requests are not retried automatically.

With successful web retrieval, the app then makes one company-specific value lookup per returned company and GLM extraction calls in batches of up to 15 companies. This may add API charges. It asks for reported market capitalization for listed companies and the latest reported post-money valuation for private companies, excluding funding amounts, revenue, and share prices. Only figures reported in USD are accepted; the app does not invent currency conversions. Each value needs a date and a URL from that company's actual lookup. Invalid numbers, fabricated URLs, invalid or future dates, and missing figures become **Unknown**. These are AI-extracted, dated reported values, not a live market-price feed or independently verified figures. Value lookup or extraction failures preserve the company catalog, and progress continues as value batches finish.

This version provides **company recommendations**, not verified live openings. Suggested roles do not mean a company is currently hiring. Verify websites, locations, descriptions, and matching details yourself. Company cards only associate source URLs actually returned by GLM for the current request; having a source does not guarantee the company information has been verified. A notice appears when no web sources are returned or web search is disabled.

## Verify and package

```sh
npm run typecheck
npm test
npm run test:smoke
npm run package:mac
```

The smoke test launches a real Electron window with an isolated temporary profile and replaces network calls in the main process with test fixtures, so no paid API is used. It checks the English home and preview screens; compact layout; JSON editing, invalid edits, save-to-disk, and persistence across restarts; file import and reload; retrieval failure fallback; 100-per-category collection (200 companies across two categories); category deduplication; progress; preservation on cancellation; pagination; sourced values and numerical sorting; search IPC; key clearing; filtering; copying; errors; cancellation; isolation; and link validation. Screenshots are written to `artifacts/`. A real GLM search requires your own key and account access; these automated checks do not verify live search quality.

Packaging produces an Apple Silicon `.app` and ZIP in `release/`. Use `npm run package:dir` to build only the `.app`. For an Intel Mac, run `npm run build`, then `npx electron-builder --mac zip --x64`. These local test builds are unsigned and not notarized. Configure Developer ID signing and Apple notarization before public distribution. Automatic updates are not included.

The main process handles files, GLM requests, and system operations. The preload bridge exposes only fixed IPC methods. React renders the interface. The renderer uses context isolation and sandboxing, with Node integration, navigation, new windows, and permission requests disabled. The UI loads no remote images or scripts.

The editable panda-with-magnifier icon source is `build/icon.svg`, shared by the interface and macOS app. `build/icon.png` is its rendered preview. On macOS, run `npm run icon` to regenerate the ICNS file. The `global-agent` development dependency is overridden to a compatible 4.x release to avoid a known formatting vulnerability in the packager's transitive dependencies.
