import type { PositionedGraph } from '../contracts/positioned';
import {
    distributionForFields,
    distributionFromAttributes,
    pieGroupingForFields,
} from '../render/mapping/pieDistribution';
import { detectPieSliceKeys, resolvePieSliceColors } from '../render/mapping/pieColors';
import {
    PIE_ATTRIBUTE_PREFIX,
    PIE_OTHER_SLICE_KEY,
    PIE_OTHER_SLICE_LABEL,
    type PieCategory,
    type PieCategoryGrouping,
} from '../render/mapping/pieMapping.types';

/** Count for one value, or one observed combination of selected column values. */
export type CategoryCount = {
    /** Stable key shared with the graph's category colors. */
    key: string;
    /** Category identity used for the user's color and grouping choices. */
    category: string;
    label: string;
    /** Number of observations contributing to this category, including group weights. */
    count: number;
};

/** The category count with the percentage and color needed by the chart and legend. */
export type CategoryFrequency = CategoryCount & {
    percentage: number;
    color: string;
};

export type AncillaryDistribution = {
    /** Sum of category counts; a node can represent more than one observation. */
    observationCount: number;
    /** Number of included graph nodes, rather than the number of isolates they represent. */
    nodeCount: number;
    categories: CategoryFrequency[];
};

export type AncillaryDistributionOptions = {
    /** Restrict counts to these nodes while keeping the whole view's colors and grouping. */
    includeNodeIds?: ReadonlySet<string>;
    /** Selected column names. Omit to use the graph's current pie categories. */
    fields?: string[];
    palette?: string[];
    categoryColors?: Record<string, string>;
    categoryGrouping?: PieCategoryGrouping;
    /** False lists every category for the palette editor, without grouping into Other. */
    groupCategories?: boolean;
};

type NodeCategories = {
    id: string;
    attributes?: Record<string, unknown>;
    distribution?: PieCategory[];
    grouping?: PieCategoryGrouping;
};

/** Count ancillary values and compute percentages, without changing the graph or the DOM. */
export function calculateAncillaryDistribution(
    graph: PositionedGraph,
    options: AncillaryDistributionOptions = {}
): AncillaryDistribution | null {
    const grouping = options.categoryGrouping
        ? pieGroupingForFields(options.fields ?? [], options.categoryGrouping)
        : undefined;
    const nodes: NodeCategories[] = graph.nodes.map(node => ({
        id: node.id,
        attributes: node.attributes,
        distribution: options.fields ? distributionForFields(node.attributes, options.fields) : undefined,
        grouping: options.fields ? grouping : undefined,
    }));

    // Choose display categories before counting the subset, so all charts match the graph.
    const categoryKeys =
        options.groupCategories === false
            ? [...new Set(nodes.flatMap(node => storedCategories(node).map(category => category.key)))]
            : detectPieSliceKeys(nodes);
    const colors = resolvePieSliceColors(nodes, categoryKeys, options.palette, options.categoryColors);
    const { counts, nodeCount } = countCategories(nodes, new Set(categoryKeys), options);
    const observationCount = [...counts.values()].reduce((total, category) => total + category.count, 0);
    if (!observationCount) return null;

    const categories = [...counts.values()]
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .map(category => ({
            ...category,
            percentage: (category.count / observationCount) * 100,
            color: colors[category.key],
        }));
    return { observationCount, nodeCount, categories };
}

function countCategories(
    nodes: NodeCategories[],
    displayed: ReadonlySet<string>,
    options: AncillaryDistributionOptions
) {
    const counts = new Map<string, CategoryCount>();
    let nodeCount = 0;
    for (const node of nodes) {
        if (options.includeNodeIds && !options.includeNodeIds.has(node.id)) continue;
        nodeCount++;
        for (const category of categoriesToCount(node, options.fields !== undefined)) {
            const key = displayed.has(category.key) ? category.key : PIE_OTHER_SLICE_KEY;
            counts.set(key, {
                key,
                category: key === PIE_OTHER_SLICE_KEY ? key : category.category,
                label: key === PIE_OTHER_SLICE_KEY ? PIE_OTHER_SLICE_LABEL : category.label,
                count: (counts.get(key)?.count ?? 0) + category.value,
            });
        }
    }
    return { counts, nodeCount };
}

function storedCategories(node: NodeCategories): PieCategory[] {
    return node.distribution ?? distributionFromAttributes(node.attributes);
}

function categoriesToCount(node: NodeCategories, fieldsSelected: boolean): PieCategory[] {
    const categories = storedCategories(node);
    if (categories.length || fieldsSelected) return categories;

    // Direct renderer inputs can contain numeric pie attributes without observation records.
    const result: PieCategory[] = [];
    for (const [key, value] of Object.entries(node.attributes ?? {})) {
        if (key.startsWith(PIE_ATTRIBUTE_PREFIX) && typeof value === 'number' && value > 0)
            result.push({ key, category: key, label: key.slice(PIE_ATTRIBUTE_PREFIX.length), value });
    }
    return result;
}
