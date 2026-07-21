create table if not exists prepare_jobs(
    job_id text primary key,
    dataset_id text not null,
    layout_version text not null,
    status text not null
        check (status in ('queued', 'running', 'ready', 'failed', 'cancelled')),
    dataset_payload jsonb not null,
    warnings jsonb not null default '[]'::jsonb,
    result jsonb,
    error text,
    worker_id text,
    lease_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function phylo_lens_touch_prepare_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_prepare_jobs_touch_updated_at on prepare_jobs;

create trigger trg_prepare_jobs_touch_updated_at
before update on prepare_jobs
for each row
execute function phylo_lens_touch_prepare_jobs_updated_at();

create unique index if not exists idx_prepare_jobs_reusable_layout
    on prepare_jobs(dataset_id, layout_version)
    where status in ('queued', 'running', 'ready');

create index if not exists idx_prepare_jobs_claim
    on prepare_jobs(status, created_at)
    where status in ('queued', 'running');

create index if not exists idx_prepare_jobs_layout
    on prepare_jobs(dataset_id, layout_version);

create index if not exists idx_prepare_jobs_lease
    on prepare_jobs(lease_expires_at)
    where status = 'running';

create table if not exists datasets(
    dataset_id text not null,
    layout_version text not null,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key(dataset_id, layout_version)
);

create table if not exists prepared_clusters(
    dataset_id text not null,
    layout_version text not null,
    cluster_id text not null,
    threshold double precision,
    representative_node_id text,
    member_count integer not null default 0,
    x double precision,
    y double precision,
    radius double precision,
    min_x double precision,
    max_x double precision,
    min_y double precision,
    max_y double precision,
    status text not null,
    primary key(dataset_id, layout_version, cluster_id)
);

create table if not exists cluster_members(
    dataset_id text not null,
    layout_version text not null,
    cluster_id text not null,
    node_id text not null,
    primary key(dataset_id, layout_version, cluster_id, node_id)
);

create table if not exists graph_edges(
    dataset_id text not null,
    layout_version text not null,
    edge_id text not null,
    source_node_id text not null,
    target_node_id text not null,
    distance double precision,
    primary key(dataset_id, layout_version, edge_id)
);

create table if not exists prepared_edges(
    dataset_id text not null,
    layout_version text not null,
    lod_level integer not null,
    edge_id text not null,
    source_node_id text not null,
    target_node_id text not null,
    distance double precision,
    primary key(dataset_id, layout_version, lod_level, edge_id)
);

create table if not exists node_positions(
    dataset_id text not null,
    layout_version text not null,
    cluster_id text not null,
    node_id text not null,
    x double precision not null,
    y double precision not null,
    status text not null,
    primary key(dataset_id, layout_version, cluster_id, node_id)
);

create table if not exists metadata_schema(
    dataset_id text not null,
    layout_version text not null,
    field_key text not null,
    field_type text not null,
    primary key(dataset_id, layout_version, field_key)
);

create table if not exists node_metadata(
    dataset_id text not null,
    layout_version text not null,
    node_id text not null,
    metadata_json text not null,
    primary key(dataset_id, layout_version, node_id)
);

create table if not exists cluster_metadata(
    dataset_id text not null,
    layout_version text not null,
    cluster_id text not null,
    metadata_json text not null,
    primary key(dataset_id, layout_version, cluster_id)
);

create or replace function phylo_lens_touch_datasets_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_datasets_touch_updated_at on datasets;

create trigger trg_datasets_touch_updated_at
before update on datasets
for each row
execute function phylo_lens_touch_datasets_updated_at();

create index if not exists idx_node_positions_node_id
    on node_positions(dataset_id, layout_version, node_id);
create index if not exists idx_node_positions_cluster_id
    on node_positions(dataset_id, layout_version, cluster_id);
create index if not exists idx_node_positions_xy
    on node_positions(dataset_id, layout_version, x, y);
create index if not exists idx_prepared_clusters_threshold
    on prepared_clusters(dataset_id, layout_version, threshold);
create index if not exists idx_prepared_clusters_bounds
    on prepared_clusters(
        dataset_id, layout_version, threshold, max_x, min_x, max_y, min_y
    );
create index if not exists idx_prepared_edges_lod
    on prepared_edges(dataset_id, layout_version, lod_level);
create index if not exists idx_prepared_edges_endpoints
    on prepared_edges(
        dataset_id, layout_version, lod_level, source_node_id, target_node_id
    );
create index if not exists idx_graph_edges_endpoints
    on graph_edges(dataset_id, layout_version, source_node_id, target_node_id);
create index if not exists idx_graph_edges_target_endpoints
    on graph_edges(dataset_id, layout_version, target_node_id, source_node_id);
