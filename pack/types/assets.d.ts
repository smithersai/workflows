import type { ComponentType } from "react";

type MdxProps = Record<string, unknown>;
type MdxComponent = ComponentType<MdxProps>;

declare module "*.md" {
  const Component: MdxComponent;
  export default Component;
}

declare module "*.mdx" {
  const Component: MdxComponent;
  export default Component;
}
