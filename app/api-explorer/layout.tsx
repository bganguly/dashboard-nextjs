import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spring Boot — API Explorer",
  description: "Interactive REST API explorer for the Spring Boot Dashboard.",
};

export default function ApiExplorerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
