import { extensionApi } from "@/util/extension";
import { SearchProvider, type SearchOptions, type SearchResult } from "..";

interface BraveApiSearchResult {
  type: "search_result";
  subtype: "generic";
  is_live: boolean;
  language: string;

  title: string;
  url: string;

  is_source_local: boolean;
  is_source_both: boolean;

  family_friendly: boolean;

  description?: string;
  extra_snippets?: string[];
}

interface BraveApiSearch {
  type: "search";
  results: BraveApiSearchResult[];
  family_friendly: boolean;
}

interface BraveApiResult {
  web?: BraveApiSearch;
}

export class BraveSearchProvider extends SearchProvider {
  private braveApiKey: string;

  constructor(braveApiKey: string) {
    super();
    this.braveApiKey = braveApiKey;
  }

  override async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const searchParams = new URLSearchParams();
    searchParams.set("q", query);
    if (options?.count) searchParams.set("count", options.count.toString());

    const data = (await extensionApi.fetchJSON(`https://api.search.brave.com/res/v1/web/search?${searchParams}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.braveApiKey,
      },
      method: "GET",
    })) as BraveApiResult;

    const results: SearchResult[] = [];

    if (data.web) {
      for (const result of data.web.results) {
        results.push({
          title: result.title,
          url: result.url,

          description: result.description,
          extra: result.extra_snippets,
        });
      }
    }

    return results;
  }
}
