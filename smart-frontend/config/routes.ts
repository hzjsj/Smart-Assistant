export default [
  {
    path: '/chat',
    layout: false,
    component: './chat',
  },
  {
    path: '/copilot/:id',
    layout: false,
    component: './copilot',
  },
  {
    name: '文档管理',
    icon: 'fileText',
    path: '/document-list',
    component: './document-list',
  },
  {
    name: 'AI 出卷',
    icon: 'form',
    path: '/generate-test-paper',
    component: './generate-test-paper',
  },
  {
    path: '/user',
    layout: false,
    routes: [
      {
        name: '登录',
        path: '/user/login',
        component: './user/login',
      },
    ],
  },
  {
    path: '/welcome',
    name: '欢迎',
    icon: 'smile',
    component: './Welcome',
  },
  {
    path: '/admin',
    name: '管理页',
    icon: 'crown',
    access: 'canAdmin',
    routes: [
      {
        path: '/admin',
        redirect: '/admin/sub-page',
      },
      {
        path: '/admin/sub-page',
        name: '二级管理页',
        component: './Admin',
      },
    ],
  },
  {
    name: '用户管理',
    icon: 'team',
    path: '/user-list',
    access: 'canAdmin',
    component: './user-list',
  },
  {
    name: 'AI 助手',
    icon: 'comment',
    path: '/chatbot',
    component: './chatbot',
  },
  {
    name: '查询表格',
    icon: 'table',
    path: '/list',
    component: './table-list',
  },
  {
    path: '/',
    redirect: '/welcome',
  },
  {
    component: './exception/404',
    layout: false,
    path: './*',
  },
];
