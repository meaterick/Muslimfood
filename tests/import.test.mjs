import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCertifiedMenu, seoulVegetarian, suwonVegan } from '../scripts/import-kr.mjs';

test('Seoul certified dishes keep their diet labels', () => {
  assert.deepEqual(parseCertifiedMenu('[비건]두부텐더또띠아,[락토]리코타 샐러드, [락토오보] 에그 샌드위치,김밥'), {
    mn: ['두부텐더또띠아', '리코타 샐러드', '에그 샌드위치', '김밥'],
    mv: ['v', 'l', 'lo', ''],
  });
  assert.deepEqual(parseCertifiedMenu(''), { mn: [], mv: [] });
});

test('Seoul vegetarian list: whole-menu vs some dishes, vegan detection, Seoul bounds', () => {
  const rows = [
    { '식품인증업소 관리 일련번호(pk)  seq': '19650', 인증구분: '채식전문음식점', 업소명: '살롱드비건', 'y좌표': '37.5403912', 'x좌표': '126.8956724', 인증메뉴: '[비건]비건핫도그,[비건]두부텐더', 인증일자: '20260101', 사용여부: 'Y', 인증여부: 'Y', '주소_도로명상세주소': '서울특별시 영등포구 양평로22길 31' },
    { '식품인증업소 관리 일련번호(pk)  seq': '19651', 인증구분: '채식가능음식점', 업소명: '음무아', 'y좌표': '37.5625', 'x좌표': '126.9260', 인증메뉴: '[비건]토마토 스파게티,[락토]리코타', 인증일자: '20260101', 사용여부: 'Y', 인증여부: 'Y' },
    { '식품인증업소 관리 일련번호(pk)  seq': '1', 인증구분: '통쾌한 한끼 식당', 업소명: '다른 업소', 'y좌표': '37.5', 'x좌표': '126.9' },
    { '식품인증업소 관리 일련번호(pk)  seq': '2', 인증구분: '채식전문음식점', 업소명: '좌표 오류', 'y좌표': '0', 'x좌표': '0' },
  ];
  const out = seoulVegetarian(rows);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].id, out[0].s, out[0].dv, out[0].d], ['seoul-19650', 'V', 'vegan', '2026-01-01']);
  assert.deepEqual([out[1].s, out[1].dv, out[1].mv], ['M', 'vegetarian', ['v', 'l']]);
});

test('Suwon vegan menus: whole menu, bakery category, duplicated address prefix', () => {
  const out = suwonVegan([
    { 업소종류: '비건레스토랑(전부메뉴)', 업소명: '뜰안채', 위도: '37.2632922', 경도: '126.9434572', 식당구분: '한식', 대표비건음식: '채식뷔페', 소재지도로명주소: '경기도 수원시 경기도 수원시 권선구 칠보로88번길 125', 데이터기준일자: '2026-05-14', 전화번호: '031-291-5879' },
    { 업소종류: '비건베이커리(일부메뉴)', 업소명: '베이커리 일상', 위도: '37.30326272', 경도: '127.0057737', 식당구분: '제과제빵', 대표비건음식: '호두베리통밀 등', 전화번호: '0' },
  ]);
  assert.deepEqual([out[0].s, out[0].k, out[0].a, out[0].mn, out[0].cu], ['V', 'r', '경기도 수원시 권선구 칠보로88번길 125', ['채식뷔페'], ['korean']]);
  assert.deepEqual([out[1].s, out[1].k, out[1].ph], ['M', 'c', undefined]);
  assert.match(out[0].id, /^suwon-[0-9a-z]+$/);
  assert.equal(suwonVegan([{ 업소종류: '비건레스토랑(전부메뉴)', 업소명: '뜰안채', 위도: '37.2632922', 경도: '126.9434572', 소재지도로명주소: '경기도 수원시 경기도 수원시 권선구 칠보로88번길 125' }])[0].id, out[0].id, 'ids are stable');
});

test('characters lost in EUC-KR exports are dropped, phone spacing is cleaned', async () => {
  const { dropLostChars } = await import('../scripts/import-kr.mjs');
  assert.equal(dropLostChars('콩?콩?'), '콩콩');
  assert.equal(dropLostChars('?얌꿍(면/밥/비건)'), '얌꿍(면/밥/비건)');
  assert.equal(dropLostChars('Why? Not'), 'Why? Not');
  const [p] = suwonVegan([{ 업소종류: '비건카페(일부메뉴)', 업소명: '모앤더비', 위도: '37.29859', 경도: '126.96878', 전화번호: '031- 253-8462' }]);
  assert.equal(p.ph, '031-253-8462');
});
