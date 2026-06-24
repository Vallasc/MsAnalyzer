// ── Node/Edge visual config ─────────────────────────────────────────────────
export const CFG = { nodeW:220, nodeH:52, nodeRx:7, colPadX:55, topPad:60, botPad:60 };

export const NODE_CFG = {
  ecs:       { bg:'#ea580c', text:'#fff', badge:'ECS', label:'ECS'       },
  lambda:    { bg:'#f59e0b', text:'#fff', badge:'λ',   label:'Lambda'    },
  sqs:       { bg:'#db2777', text:'#fff', badge:'SQS', label:'SQS'       },
  dynamodb:  { bg:'#2563eb', text:'#fff', badge:'DB',  label:'DynamoDB'  },
  eventbus:  { bg:'#ec4899', text:'#fff', badge:'EB',  label:'EventBus'  },
  eventrule: { bg:'#a855f7', text:'#fff', badge:'R',   label:'EventRule' },
  external:  { bg:'#dc2626', text:'#fff', badge:'EXT', label:'External'  },
};

export const EDGE_CFG = {
  reads:        { stroke:'#7c3aed', dash:'',    label:'reads',        w:1.5 },
  writes:       { stroke:'#047857', dash:'',    label:'writes',       w:1.5 },
  reads_writes: { stroke:'#0369a1', dash:'',    label:'reads/writes', w:2.2 },
  triggers:     { stroke:'#b45309', dash:'',    label:'triggers',     w:1.5 },
  calls:        { stroke:'#b91c1c', dash:'',    label:'calls',        w:2.2 },
};

export const PAN_DIM_OPACITY = 0.3;

// Colori distinti per i gruppi repo nei layout cluster (ciclano se >N repo)
export const CLUSTER_COLORS = [
  '#0369a1','#065f46','#7c2d12','#5b21b6',
  '#881337','#0f766e','#92400e','#1e40af',
  '#9f1239','#115e59','#854d0e','#4338ca',
  '#6d28d9','#b45309','#0e7490','#166534',
];

export const LS_REPOS  = 'msa2_repos';
export const LS_RELS   = 'msa2_rels';
export const LS_TYPES  = 'msa2_types';
export const LS_OPTS   = 'msa2_opts';
export const LS_LAYOUT = 'msa2_layout';

export const DEFAULT_REPOS = [
  { owner:'pagopa', repo:'pn-delivery-push-workflow', checked:true  },
  { owner:'pagopa', repo:'pn-paper-channel',          checked:true  },
  { owner:'pagopa', repo:'pn-paper-tracker',          checked:true  },
  { owner:'pagopa', repo:'pn-delivery',               checked:false },
];

export const DEFAULT_FILTERS = {
  rels:   ['reads','writes','reads_writes','triggers','calls'],
  types:  ['ecs','lambda','sqs','dynamodb','eventbus','eventrule','external'],
  labels: false,
  focus:  true,
};
