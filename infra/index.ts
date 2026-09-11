import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config    = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

const project          = gcpConfig.require("project");
const region           = gcpConfig.get("region")           ?? "us-central1";
const namePrefix       = config.get("namePrefix")           ?? "dash-nextjs";
const frontendImage    = config.require("frontendImage");
const springApiUrl     = config.require("springApiUrl");
const minInstanceCount = config.getNumber("minInstanceCount") ?? 0;
const maxInstanceCount = config.getNumber("maxInstanceCount") ?? 3;
const cpu              = config.get("cpu")                   ?? "1";
const memory           = config.get("memory")               ?? "512Mi";

const frontendService = new gcp.cloudrunv2.Service("frontend", {
  name: `${namePrefix}-frontend`,
  location: region,
  template: {
    containers: [{
      image: frontendImage,
      ports: [{ containerPort: 3000 }],
      resources: { limits: { cpu, memory } },
      envs: [{
        name: "SPRING_API_URL",
        value: springApiUrl,
      }],
    }],
    scaling: { minInstanceCount, maxInstanceCount },
  },
  traffics: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }],
});

new gcp.cloudrunv2.ServiceIamMember("frontend-public", {
  project,
  location: region,
  name: frontendService.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

export const frontendUrl = frontendService.uri;
