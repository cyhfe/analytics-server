import { Router } from "express";
import UAParser from "ua-parser-js";
import { prisma } from "./prismaClient";
import { Prisma } from "@prisma/client";
import { BadRequestError } from "./error";
const router = Router();

router.get("/analytics/metrics", async (req, res, next) => {
  try {
    const { wid } = req.body as { wid: string };
    console.log(wid);
    if (!wid) throw new BadRequestError({ message: "missing wid" });
    const uniqueVisitors = await prisma.session.count({
      where: {
        wid,
      },
    });

    const totalVisits = await prisma.viewData.count({
      where: {
        wid,
      },
    });

    const onlineVisitors = await prisma.session.count({
      where: {
        wid,
        online: true,
      },
    });

    const {
      _sum: { count: totalPageViews },
    } = await prisma.viewData.aggregate({
      _sum: {
        count: true,
      },
    });

    if (totalPageViews == null) {
      return next(new Error("totalPageViews is null"));
    }

    const viewsPerVisit = totalPageViews / totalVisits;

    const {
      _avg: { duration: avgVisitDuration },
    } = await prisma.viewData.aggregate({
      _avg: {
        duration: true,
      },
      where: {
        wid,
      },
    });

    const groupBy = await prisma.session.groupBy({
      by: ["createdAt"],
      _count: {
        online: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const groupBy2 = await prisma.session.groupBy({
      by: ["createdAt"],
      _count: {
        id: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const groupBy3 = await prisma.viewData.groupBy({
      by: ["createdAt"],
      _sum: {
        duration: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(groupBy, groupBy2, groupBy3);

    res.status(200);
    return res.json({
      uniqueVisitors,
      onlineVisitors,
      totalVisits,
      totalPageViews,
      viewsPerVisit,
      avgVisitDuration,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/analytics/enter", async (req, res, next) => {
  const { wid, sessionId } = req.body;

  if (sessionId) {
    console.log("enter again");
    try {
      await prisma.session.update({
        where: {
          id: sessionId,
        },
        data: {
          online: true,
        },
      });
      res.send(sessionId);
    } catch (error) {
      next("error");
    }
    return;
  }

  console.log("first enter");

  let ip = "::ffff:112.10.225.55";
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  const { country_name }: { country_name: string | undefined } = await (
    await fetch("https://api.iplocation.net/?ip=" + ip)
  ).json();

  const parser = new UAParser(req.headers["user-agent"]); // you need to pass the user-agent for nodejs

  const { browser, os, device } = parser.getResult();

  let session: Prisma.PromiseReturnType<typeof prisma.session.findUnique>;

  try {
    session = await prisma.session.findUnique({
      where: {
        wid,
        unique_user: {
          ip,
          browser: browser.name ?? "",
          os: os.name ?? "",
        },
      },
    });
    if (session == null) {
      session = await prisma.session.create({
        data: {
          wid,
          ip,
          online: true,
          browser: browser.name ?? "",
          os: os.name ?? "",
          device: device.model,
          country: country_name,
        },
      });
    }

    await prisma.session.update({
      where: {
        id: session.id,
      },
      data: {
        online: true,
      },
    });

    res.send(session.id);
  } catch (error) {
    console.log(error);
    next(error);
  }
});

router.post("/analytics/leave", async (req, res, next) => {
  const { pageViewsData, screen, language, referrer, sessionId, wid } =
    req.body;
  if (!sessionId) {
    return res.send("require sessionId");
  }
  if (!wid) {
    return res.send("require wid");
  }
  try {
    const session = await prisma.session.findUnique({
      where: {
        id: sessionId,
      },
    });

    if (!session) {
      return res.send("require sessionId");
    }

    for (const pathname in pageViewsData) {
      let page: Prisma.PromiseReturnType<typeof prisma.page.findUnique>;
      page = await prisma.page.findUnique({
        where: {
          pathname,
        },
      });
      if (!page) {
        page = await prisma.page.create({
          data: {
            wid,
            pathname,
          },
        });
      }

      await prisma.viewData.create({
        data: {
          wid,
          sessionId: session.id,
          pageId: page.id,
          duration: pageViewsData[pathname].duration,
          count: pageViewsData[pathname].count,
          referrer,
          screen,
          language,
        },
      });
    }

    await prisma.session.update({
      where: {
        id: session.id,
      },
      data: {
        online: false,
      },
    });

    res.send("ok");
  } catch (error) {
    next(error);
    console.log(error);
  }
});

export { router };
