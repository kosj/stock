import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";
import { SectorService } from "@/lib/server/sector-service";

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const pathArray = params.path;
    const [resource, ...rest] = pathArray;

    // ─── Portfolio ────────────────────────────────────────────────────────────
    if (resource === "portfolio") {
      return handlePortfolio(request, rest);
    }

    // ─── Market ───────────────────────────────────────────────────────────────
    if (resource === "market") {
      return handleMarket(request, rest);
    }

    // ─── Analysis ──────────────────────────────────────────────────────────────
    if (resource === "analysis") {
      return handleAnalysis(request, rest);
    }

    // ─── Macro ────────────────────────────────────────────────────────────────
    if (resource === "macro") {
      return NextResponse.json(
        { message: "Macro API not implemented" },
        { status: 501 }
      );
    }

    // ─── Sectors ───────────────────────────────────────────────────────────────
    if (resource === "sectors") {
      return await handleSectors(request, rest);
    }

    // ─── KRX ───────────────────────────────────────────────────────────────────
    if (resource === "krx") {
      return await handleKrx(request, rest);
    }

    // ─── Push ──────────────────────────────────────────────────────────────────
    if (resource === "push") {
      return handlePush(request, rest);
    }

    return NextResponse.json(
      { error: "Not found" },
      { status: 404 }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

async function handlePortfolio(request: NextRequest, path: string[]) {
  if (path.length === 0) {
    // /api/portfolio
    return NextResponse.json(
      { message: "Portfolio API not implemented" },
      { status: 501 }
    );
  }

  const [action, ...rest] = path;

  if (action === "positions" && rest.length > 0) {
    // /api/portfolio/positions/{posId}
    const posId = rest[0];
    if (request.method === "PUT") {
      return NextResponse.json(
        { message: "Portfolio update position not implemented" },
        { status: 501 }
      );
    }
    if (request.method === "DELETE") {
      return NextResponse.json(
        { message: "Portfolio delete position not implemented" },
        { status: 501 }
      );
    }
  }

  if (action === "kis") {
    // /api/portfolio/kis/*
    const kisAction = rest[0];
    if (kisAction === "positions") {
      return NextResponse.json(
        { message: "KIS positions API not implemented" },
        { status: 501 }
      );
    }
    if (kisAction === "balance") {
      return NextResponse.json(
        { message: "KIS balance API not implemented" },
        { status: 501 }
      );
    }
  }

  if (action === "watchlist") {
    // /api/portfolio/watchlist/*
    return NextResponse.json(
      { message: "Portfolio watchlist API not implemented" },
      { status: 501 }
    );
  }

  return NextResponse.json(
    { message: "Portfolio API not implemented" },
    { status: 501 }
  );
}

async function handleMarket(request: NextRequest, path: string[]) {
  if (path.length === 0) {
    return NextResponse.json(
      { message: "Market API not implemented" },
      { status: 501 }
    );
  }

  const [action, ...rest] = path;

  if (action === "search") {
    // /api/market/search?q=...
    return NextResponse.json(
      { message: "Market search API not implemented" },
      { status: 501 }
    );
  }

  if (action === "quote" && rest.length > 0) {
    // /api/market/quote/{ticker}
    return NextResponse.json(
      { message: "Market quote API not implemented" },
      { status: 501 }
    );
  }

  if (action === "chart" && rest.length > 0) {
    // /api/market/chart/{ticker}
    return NextResponse.json(
      { message: "Market chart API not implemented" },
      { status: 501 }
    );
  }

  if (action === "financials" && rest.length > 0) {
    // /api/market/financials/{ticker}
    return NextResponse.json(
      { message: "Market financials API not implemented" },
      { status: 501 }
    );
  }

  if (action === "indices") {
    // /api/market/indices
    return NextResponse.json(
      { message: "Market indices API not implemented" },
      { status: 501 }
    );
  }

  return NextResponse.json(
    { message: "Market API not implemented" },
    { status: 501 }
  );
}

async function handleAnalysis(request: NextRequest, path: string[]) {
  if (path.length === 0) {
    return NextResponse.json(
      { message: "Analysis API not implemented" },
      { status: 501 }
    );
  }

  // /api/analysis/{ticker}
  return NextResponse.json(
    { message: "Analysis API not implemented" },
    { status: 501 }
  );
}

async function handleSectors(request: NextRequest, path: string[]) {
  if (path.length === 0) {
    // /api/sectors - 섹터 성과
    try {
      const data = await SectorService.getPerformance();
      return NextResponse.json(data);
    } catch (error) {
      console.error("Sectors API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 500 }
      );
    }
  }

  const [action, ...rest] = path;

  if (action === "rotation") {
    // /api/sectors/rotation
    try {
      const data = await SectorService.getRotation();
      return NextResponse.json(data);
    } catch (error) {
      console.error("Sectors rotation API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 500 }
      );
    }
  }

  if (action === "etfs") {
    // /api/sectors/etfs?sector=...&sort_by=...
    try {
      const sector = request.nextUrl.searchParams.get("sector");
      const sortBy = request.nextUrl.searchParams.get("sort_by") || "1m";

      if (!sector) {
        return NextResponse.json(
          { error: "sector parameter required" },
          { status: 400 }
        );
      }

      const data = await SectorService.getSectorEtfs(sector, sortBy);
      return NextResponse.json(data);
    } catch (error) {
      console.error("Sectors ETFs API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { message: "Sectors API not implemented" },
    { status: 501 }
  );
}

async function handleKrx(request: NextRequest, path: string[]) {
  if (path.length === 0) {
    // /api/krx - 대시보드
    try {
      const data = await KrxService.getDashboard();
      return NextResponse.json(data);
    } catch (error) {
      console.error("KRX API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 502 }
      );
    }
  }

  const [action] = path;

  if (action === "investor") {
    // /api/krx/investor
    try {
      const data = await KrxService.getInvestor();
      return NextResponse.json(data);
    } catch (error) {
      console.error("KRX investor API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 502 }
      );
    }
  }

  if (action === "sector") {
    // /api/krx/sector
    try {
      const data = await KrxService.getSector();
      return NextResponse.json(data);
    } catch (error) {
      console.error("KRX sector API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 502 }
      );
    }
  }

  if (action === "short-selling") {
    // /api/krx/short-selling
    try {
      const data = await KrxService.getShortSelling();
      return NextResponse.json(data);
    } catch (error) {
      console.error("KRX short-selling API error:", error);
      return NextResponse.json(
        { error: String(error) },
        { status: 502 }
      );
    }
  }

  return NextResponse.json(
    { message: "KRX API not implemented" },
    { status: 501 }
  );
}

function handlePush(request: NextRequest, path: string[]) {
  if (path.length === 0) {
    return NextResponse.json(
      { message: "Push API not implemented" },
      { status: 501 }
    );
  }

  const [action] = path;

  if (action === "vapid-public-key") {
    return NextResponse.json(
      { message: "Push vapid-public-key API not implemented" },
      { status: 501 }
    );
  }

  if (action === "subscribe") {
    return NextResponse.json(
      { message: "Push subscribe API not implemented" },
      { status: 501 }
    );
  }

  if (action === "alerts") {
    return NextResponse.json(
      { message: "Push alerts API not implemented" },
      { status: 501 }
    );
  }

  return NextResponse.json(
    { message: "Push API not implemented" },
    { status: 501 }
  );
}
