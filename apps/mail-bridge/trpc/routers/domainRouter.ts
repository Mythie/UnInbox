import { z } from 'zod';
import { parse, stringify } from 'superjson';
import { router, protectedProcedure } from '../trpc';
import { and, eq } from '@uninbox/database/orm';
import {
  postalServers,
  orgPostalConfigs,
  domains
} from '@uninbox/database/schema';
import { nanoId, nanoIdLength } from '@uninbox/utils';
import { postalPuppet } from '@uninbox/postal-puppet';

export const domainRouter = router({
  createDomain: protectedProcedure
    .input(
      z.object({
        orgId: z.number().min(1),
        orgPublicId: z.string().min(3).max(nanoIdLength),
        domainName: z.string().min(3).max(255)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { config, db } = ctx;
      const { orgId, orgPublicId, domainName } = input;
      const postalOrgId = orgPublicId;

      const { puppetInstance } = await postalPuppet.initPuppet({
        postalControlPanel: config.postalControlPanel,
        postalUrl: config.postalUrl,
        postalUser: config.postalUser,
        postalPass: config.postalPass
      });

      const puppetDomainResponse = await postalPuppet.addDomain({
        puppetInstance: puppetInstance,
        orgId: orgId,
        orgPublicId: postalOrgId,
        domainName: domainName
      });

      const postalServerIdResponse =
        await db.read.query.postalServers.findFirst({
          where: and(
            eq(postalServers.orgId, orgId),
            eq(postalServers.type, 'email')
          ),
          columns: {
            publicId: true
          }
        });

      if (!postalServerIdResponse) {
        await postalPuppet.closePuppet(puppetInstance);
        return {
          error: 'No email server found'
        };
      }
      const setMailServerRouteResult =
        await postalPuppet.setMailServerRouteForDomain({
          puppetInstance: puppetInstance,
          orgId: orgId,
          orgPublicId: postalOrgId,
          serverId: postalServerIdResponse.publicId,
          domainName: domainName,
          username: '*'
        });

      await postalPuppet.closePuppet(puppetInstance);

      return {
        orgId: orgId,
        postalServerUrl: config.postalUrl as string,
        postalOrgId: postalOrgId,
        domainId: puppetDomainResponse.domainId,
        dkimKey: puppetDomainResponse.dkimKey,
        dkimValue: puppetDomainResponse.dkimValue,
        forwardingAddress: setMailServerRouteResult.forwardingAddress
      };
    })
});
