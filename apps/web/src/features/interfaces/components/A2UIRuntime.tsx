"use client";
import {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
} from "@a2ui/react/v0_9";
import type { ActionPayload, ResolvedChildRef } from "@a2ui/web_core/v0_9";
import {
  Catalog,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v0_9";
import {
  ButtonApi,
  CardApi,
  CheckBoxApi,
  ColumnApi,
  DividerApi,
  ListApi,
  RowApi,
  TabsApi,
  TextApi,
  TextFieldApi,
} from "@a2ui/web_core/v0_9/basic_catalog";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../../shared/http/api";
import { DataView, RecordForm } from "../../collections/client";
import type { Collection } from "../../collections/public";
import {
  CATALOG_ID,
  CollectionChartApi,
  CollectionFormApi,
  DataTableApi,
  PROTOCOL,
} from "../protocol/catalog";
import {
  parseInterface,
  validateBindings,
  type Interface,
} from "../protocol/document";

type Runtime = {
  workspaceId: string;
  collections: Collection[];
  epoch: number;
  refresh: () => void;
  report: (message: string) => void;
  preview: boolean;
};
const RuntimeContext = createContext<Runtime | null>(null);
function useRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("Missing PAW runtime.");
  return value;
}
const children = (
  items: (string | ResolvedChildRef)[],
  buildChild: (id: string, basePath?: string) => ReactNode,
) =>
  items.map((item, i) => (
    <Fragment key={typeof item === "string" ? item : `${item.id}-${i}`}>
      {typeof item === "string"
        ? buildChild(item)
        : buildChild(item.id, item.basePath)}
    </Fragment>
  ));
const text = createComponentImplementation(TextApi, ({ props }) => {
  const Tag =
    props.variant && ["h1", "h2", "h3", "h4", "h5"].includes(props.variant)
      ? (props.variant as "h1" | "h2" | "h3" | "h4" | "h5")
      : "p";
  return <Tag className="a2ui-text">{props.text}</Tag>;
});
const column = createComponentImplementation(
  ColumnApi,
  ({ props, buildChild }) => (
    <div
      className="a2ui-column"
      style={{
        alignItems: props.align,
        justifyContent: alignment(props.justify),
      }}
    >
      {children(props.children, buildChild)}
    </div>
  ),
);
const row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <div
    className="a2ui-row"
    style={{
      alignItems: props.align,
      justifyContent: alignment(props.justify),
    }}
  >
    {children(props.children, buildChild)}
  </div>
));
function alignment(value?: string) {
  return (
    (
      {
        spaceAround: "space-around",
        spaceBetween: "space-between",
        spaceEvenly: "space-evenly",
      } as Record<string, string>
    )[value ?? ""] ?? value
  );
}
const card = createComponentImplementation(CardApi, ({ props, buildChild }) => (
  <section className="surface">{buildChild(props.child)}</section>
));
const list = createComponentImplementation(ListApi, ({ props, buildChild }) => (
  <div
    className={props.direction === "horizontal" ? "a2ui-row" : "a2ui-column"}
  >
    {children(props.children, buildChild)}
  </div>
));
const divider = createComponentImplementation(DividerApi, () => <hr />);
const actualButton = createComponentImplementation(
  ButtonApi,
  ({ props, buildChild }) => {
    const runtime = useRuntime();
    return (
      <button
        className={props.variant === "primary" ? "primary" : ""}
        disabled={props.isValid === false}
        onClick={() => {
          void props.action().catch((error) => runtime.report(error.message));
        }}
      >
        {buildChild(props.child)}
      </button>
    );
  },
);
const input = createComponentImplementation(TextFieldApi, ({ props }) => (
  <label>
    {props.label}
    {props.variant === "longText" ? (
      <textarea
        value={props.value ?? ""}
        onChange={(e) => props.setValue(e.target.value)}
      />
    ) : (
      <input
        maxLength={10000}
        pattern={props.validationRegexp}
        value={props.value ?? ""}
        type={
          props.variant === "obscured"
            ? "password"
            : props.variant === "number"
              ? "number"
              : "text"
        }
        onChange={(e) => props.setValue(e.target.value)}
      />
    )}
    {props.validationErrors?.map((error, i) => (
      <span className="error" key={i}>
        {error}
      </span>
    ))}
  </label>
));
const checkbox = createComponentImplementation(CheckBoxApi, ({ props }) => (
  <label className="check-label">
    <input
      type="checkbox"
      checked={props.value ?? false}
      onChange={(e) => props.setValue(e.target.checked)}
    />
    {props.label}
  </label>
));
const tabs = createComponentImplementation(TabsApi, ({ props, buildChild }) => (
  <TabView items={props.tabs} buildChild={buildChild} />
));
function TabView({
  items,
  buildChild,
}: {
  items: { title: unknown; child: string }[];
  buildChild: (id: string) => ReactNode;
}) {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Interface tabs">
        {items.map((item, i) => (
          <button
            key={item.child}
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
          >
            {String(item.title ?? "")}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {items[index] && buildChild(items[index].child)}
      </div>
    </div>
  );
}
const form = createComponentImplementation(
  CollectionFormApi,
  ({ props, context }) => {
    const runtime = useRuntime();
    const collection = runtime.collections.find(
      (c) => c.id === props.collectionId,
    );
    if (!collection) return <p role="alert">Collection is unavailable.</p>;
    return (
      <section className="surface">
        <h3>{props.title || `Add to ${collection.name}`}</h3>
        <fieldset disabled={runtime.preview}>
          <RecordForm
            collection={collection}
            report={runtime.report}
            save={async (data) => {
              await context.dispatchAction({
                event: {
                  name: "paw.createRecord",
                  context: { collectionId: collection.id, data },
                },
              });
            }}
          />
        </fieldset>
      </section>
    );
  },
);
const table = createComponentImplementation(DataTableApi, ({ props }) => (
  <CollectionView
    collectionId={props.collectionId}
    title={props.title}
    mode={props.presentation ?? "table"}
  />
));
const chart = createComponentImplementation(CollectionChartApi, ({ props }) => (
  <CollectionView
    collectionId={props.collectionId}
    title={props.title}
    mode="chart"
    field={props.field}
  />
));
function CollectionView({
  collectionId,
  title,
  mode,
  field,
}: {
  collectionId: string;
  title?: string;
  mode: "table" | "list" | "chart";
  field?: string;
}) {
  const runtime = useRuntime();
  const collection = runtime.collections.find((c) => c.id === collectionId);
  if (!collection) return <p role="alert">Collection is unavailable.</p>;
  return (
    <section className="surface">
      <h3>{title || collection.name}</h3>
      <DataView
        key={runtime.epoch}
        workspaceId={runtime.workspaceId}
        collection={collection}
        mode={mode}
        field={field}
        report={runtime.report}
        onChange={runtime.refresh}
        readOnly={runtime.preview}
      />
    </section>
  );
}
const reactCatalog = new Catalog(CATALOG_ID, PROTOCOL, [
  text,
  column,
  row,
  card,
  list,
  divider,
  actualButton,
  input,
  checkbox,
  tabs,
  form,
  table,
  chart,
]);
export default function A2uiRuntime({
  workspaceId,
  definition,
  collections,
  report,
  preview = false,
}: {
  workspaceId: string;
  definition: Interface;
  collections: Collection[];
  report: (message: string) => void;
  preview?: boolean;
}) {
  const [epoch, setEpoch] = useState(0);
  const [processor, setProcessor] =
    useState<MessageProcessor<ReactCatalogComponent> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let instance: MessageProcessor<ReactCatalogComponent> | undefined;
    try {
      const valid = parseInterface(definition);
      validateBindings(valid, collections);
      instance = new MessageProcessor(
        [reactCatalog],
        async (event: ActionPayload) => {
          if (event.name === "paw.refresh") {
            setEpoch((e) => e + 1);
            return;
          }
          if (preview)
            throw new Error(
              "Preview is read-only. Save and use the Workspace tab to change records.",
            );
          if (event.name !== "paw.createRecord")
            throw new Error("Unsupported action.");
          const collectionId = event.context.collectionId;
          if (!collections.some((c) => c.id === collectionId))
            throw new Error("Collection is outside this workspace.");
          await api(
            `workspaces/${workspaceId}/collections/${collectionId}`,
            "POST",
            { data: event.context.data },
          );
          setEpoch((e) => e + 1);
        },
        { version: PROTOCOL, validationConfig: STRICT_VALIDATION },
      );
      instance.processMessages(valid.messages);
      setProcessor(instance);
      setError("");
    } catch (error) {
      setProcessor(null);
      setError((error as Error).message);
    }
    return () => instance?.dispose();
  }, [definition, workspaceId, collections, preview]);
  if (error)
    return (
      <div role="alert" className="error">
        {error}
      </div>
    );
  if (!processor) return <p role="status">Preparing interface…</p>;
  return (
    <RuntimeContext.Provider
      value={{
        workspaceId,
        collections,
        epoch,
        refresh: () => setEpoch((e) => e + 1),
        report,
        preview,
      }}
    >
      <div className="a2ui-runtime">
        {[...processor.getSurfaces().values()].map((surface) => (
          <A2uiSurface key={surface.id} surface={surface} />
        ))}
      </div>
    </RuntimeContext.Provider>
  );
}
